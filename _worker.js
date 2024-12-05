// @ts-ignore
import { connect } from 'cloudflare:sockets';
//伪装主页设置
let token= 'error';
let pdomain = 'www.pptv.com';
//uuid设置
let userID = 'd342d11e-d424-4583-b36e-524ab1f0afa4';
//订阅器设置
let RproxyIP = 'false';
let sub = 'alvless.comorg.us.kg';
let subconfig = 'https://raw.githubusercontent.com/JustLagom/WorkerSub/main/urltestconfig.ini';
//CF网络穿透设置 一:proxyip，二:SOCKS5
let proxyIP = 'edgetunnel.anycast.eu.org';
let socks5Address = '';

if (!isValidUUID(userID)) {
	throw new Error('uuid is not valid');
}

let parsedSocks5Address = {}; 
let enableSocks = false;

export default {
	/**
	 * @param {{TOKEN, PDOMAIN, UUID, RPROXYIP, SUB, SUBCONFIG, PROXYIP, SOCKS5: string}} env
	 * @returns {Promise<Response>}
	 */
	async fetch(request, env, ctx) {
		try {
			token = env.TOKEN || token;
			pdomain = env.PDOMAIN || pdomain;
			userID = env.UUID || userID;
			RproxyIP = env.RPROXYIP || RproxyIP
			sub = env.SUB || sub;
			subconfig = env.SUBCONFIG || subconfig;
			proxyIP = env.PROXYIP || proxyIP;
			socks5Address = env.SOCKS5 || socks5Address;
			if (socks5Address) {
				try {
					parsedSocks5Address = socks5AddressParser(socks5Address);
					enableSocks = true;
				} catch (err) {
  			/** @type {Error} */ let e = err;
					console.log(e.toString());
					enableSocks = false;
				}
			}
			const upgradeHeader = request.headers.get('Upgrade');
			const url = new URL(request.url);
			if (!upgradeHeader || upgradeHeader !== 'websocket') {
				switch (url.pathname) {					
					case `/${token}`: {
						const Config = await getCONFIG(userID, request.headers.get('Host'), sub, RproxyIP, url);
						return new Response(`${Config}`, {
							status: 200,
							headers: {
								"Content-Type": "text/plain;charset=utf-8",
							}
						});
					}
					default:
					        url.hostname = pdomain;
					        url.protocol = 'https:';
					        request = new Request(url, request);
					        return await fetch(request);
				}
			} else {
				      proxyIP = url.searchParams.get('proxyIP') || proxyIP;
				      if (new RegExp('/proxyIP=', 'i').test(url.pathname)) proxyIP = url.pathname.toLowerCase().split('/proxyIP=')[1];
				      else if (new RegExp('/proxyIP.', 'i').test(url.pathname)) proxyIP = `proxyIP.${url.pathname.toLowerCase().split("/proxyIP.")[1]}`;
				      else if (!proxyIP || proxyIP == '') proxyIP = 'proxyip.fxxk.dedyn.io';
				      return await vlessOverWSHandler(request);
			}
		} catch (err) {
			/** @type {Error} */ let e = err;
			return new Response(e.toString());
		}
	},
};

/**
 *
 * @param {import("@cloudflare/workers-types").Request} request
 */
async function vlessOverWSHandler(request) {
  /** @type {import("@cloudflare/workers-types").WebSocket[]} */
  // @ts-ignore
  const webSocketPair = new WebSocketPair()
  const [client, webSocket] = Object.values(webSocketPair)

  webSocket.accept()

  let address = ''
  let portWithRandomLog = ''
  const log = (
    /** @type {string} */ info,
    /** @type {string | undefined} */ event
  ) => {
    console.log(`[${address}:${portWithRandomLog}] ${info}`, event || '')
  }
  const earlyDataHeader = request.headers.get('sec-websocket-protocol') || ''

  const readableWebSocketStream = makeReadableWebSocketStream(
    webSocket,
    log,
    earlyDataHeader
  )

  /**@type {{writable: WritableStream<ArrayBuffer>}} */
  const remoteSocketWrapper = { writable: null }

  let isDns = false
  /**@type {(chunk: ArrayBuffer)=>void} */
  let udpWriter = null

  const writableStream = new WritableStream({
    /**@param {ArrayBuffer} chunk  */
    async write(chunk) {
      if (isDns && udpWriter) return await udpWriter(chunk)
      // Read chunk until handle vless header
      if (remoteSocketWrapper.writable) {
        const writer = remoteSocketWrapper.writable.getWriter()
        writer.write(chunk)
        writer.releaseLock()
        return
      }

      const {
        hasError,
        message,
        addressType,
        portRemote = 443,
        addressRemote = '',
        rawDataIndex,
        vlessVersion = new Uint8Array([0, 0]),
        isUDP
      } = processVlessHeader(chunk, userID)

      address = addressRemote
      portWithRandomLog = `${portRemote}--${Math.random()} ${
        isUDP ? 'udp ' : 'tcp '
      }`

      // cf seems has bug, controller.error will not end stream
      if (hasError) throw new Error(message)

      if (isUDP && portRemote === 53) isDns = true
      // if UDP but port not DNS port, close it
      if (isUDP && portRemote !== 53) {
        throw new Error('UDP proxy only enable for DNS which is port 53')
      }

      // ["version", 0] 0 length
      const vlessResponseHeader = new Uint8Array([vlessVersion[0], 0])
      // raw requests' bytes data
      const raw = chunk.slice(rawDataIndex)
      if (isDns) {
        const { write } = await handleUDPOutBound(
          webSocket,
          vlessResponseHeader,
          log
        )
        udpWriter = write

        return udpWriter(raw)
      }

      handleTCPOutBound(
        remoteSocketWrapper,
        addressType,
        addressRemote,
        portRemote,
        raw,
        webSocket,
        vlessResponseHeader,
        log
      )
    },
    close() {
      log(`readableWebSocketStream is close`)
    },
    abort(reason) {
      log(`readableWebSocketStream is abort`, JSON.stringify(reason))
    }
  })

  // ws --> remote
  readableWebSocketStream.pipeTo(writableStream).catch((err) => {
    log('readableWebSocketStream pipeTo error', err)
  })

  return new Response(null, {
    status: 101,
    // @ts-ignore
    webSocket: client
  })
}

/**
 * Handles outbound TCP connections.
 *
 * @param {{writable: WritableStream<ArrayBuffer>}} remoteSocketWrapper
 * @param {number} addressType The remote address type to connect to.
 * @param {string} addressRemote The remote address to connect to.
 * @param {number} portRemote The remote port to connect to.
 * @param {ArrayBuffer} rawClientData The raw client data to write.
 * @param {import("@cloudflare/workers-types").WebSocket} webSocket The WebSocket to pass the remote socket to.
 * @param {Uint8Array} vlessResponseHeader The VLESS response header.
 * @param {function} log The logging function.
 * @returns {Promise<void>} The remote socket.
 */
async function handleTCPOutBound(
  remoteSocketWrapper,
  addressType,
  addressRemote,
  portRemote,
  rawClientData,
  webSocket,
  vlessResponseHeader,
  log
) {
  async function connectAndWrite(address, port, socks = false) {
    /** @type {import("@cloudflare/workers-types").Socket} */
    const tcpSocket = socks
      ? await socks5Connect(addressType, address, port, log)
      : connect({ hostname: address, port: port })
    remoteSocketWrapper.writable = tcpSocket.writable

    log(`connected to ${address}:${port}`)
    const writer = tcpSocket.writable.getWriter()
    await writer.write(rawClientData) // first write, normal is tls client hello
    writer.releaseLock()
    return tcpSocket
  }

  // if the cf connect tcp socket have no incoming data, we retry to redirect ip
  async function retry() {
    tcpSocket = await connectAndWrite(
      enableSocks ? addressRemote : proxyIP || addressRemote,
      portRemote,
      enableSocks
    )

    // no matter retry success or not, close websocket
    tcpSocket.closed
      .catch((error) => {
        console.log('retry tcpSocket closed error', error)
      })
      .finally(() => {
        safeCloseWebSocket(webSocket)
      })
    remoteSocketToWS(tcpSocket, webSocket, vlessResponseHeader, null, log)
  }

  let tcpSocket = await connectAndWrite(addressRemote, portRemote)

  // when remoteSocket is ready, pass to websocket
  // remote--> ws
  remoteSocketToWS(tcpSocket, webSocket, vlessResponseHeader, retry, log)
}

/**
 *
 * @param {import("@cloudflare/workers-types").WebSocket} webSocketServer
 * @param {string} earlyDataHeader for ws 0rtt
 * @param {(info: string)=> void} log for ws 0rtt
 */
function makeReadableWebSocketStream(webSocketServer, log, earlyDataHeader) {
  let readableStreamCancel = false
  const stream = new ReadableStream({
    start(controller) {
      webSocketServer.addEventListener('message', (event) => {
        if (readableStreamCancel) return
        const message = event.data
        controller.enqueue(message)
      })

      // The event means that the client closed the client -> server stream.
      // However, the server -> client stream is still open until you call close() on the server side.
      // The WebSocket protocol says that a separate close message must be sent in each direction to fully close the socket.
      webSocketServer.addEventListener('close', () => {
        // client send close, need close server
        // if stream is cancel, skip controller.close
        safeCloseWebSocket(webSocketServer)
        if (readableStreamCancel) return
        controller.close()
      })
      webSocketServer.addEventListener('error', (err) => {
        log('webSocketServer has error')
        controller.error(err)
      })
      // for ws 0rtt
      const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader)
      if (error) {
        controller.error(error)
      } else if (earlyData) {
        controller.enqueue(earlyData)
      }
    },
    cancel(reason) {
      // 1. pipe WritableStream has error, this cancel will called, so ws handle server close into here
      // 2. if readableStream is cancel, all controller.close/enqueue need skip,
      // 3. but from testing controller.error still work even if readableStream is cancel
      if (readableStreamCancel) return
      log(`ReadableStream was canceled, due to ${reason}`)
      readableStreamCancel = true
      safeCloseWebSocket(webSocketServer)
    }
  })

  return stream
}

// https://xtls.github.io/development/protocols/vless.html
// https://github.com/zizifn/excalidraw-backup/blob/main/v2ray-protocol.excalidraw

// | 1B      | 16B    | 1B           | MB	              |  1B  | 2B    |  1B    | SB  | XB
// | version | UUID   | 附加信息长度 M | 附加信息 ProtoBuf | 指令  |  port | 地址类型 | 地址 |请求数据

/**
 * @param {ArrayBuffer} vlessBuffer
 * @param {string} userID
 * @returns
 */
function processVlessHeader(vlessBuffer, userID) {
  if (vlessBuffer.byteLength < 24) {
    return {
      hasError: true,
      message: 'invalid data'
    }
  }

  const version = new Uint8Array(vlessBuffer.slice(0, 1))
  let isValidUser = false
  let isUDP = false
  if (stringify(new Uint8Array(vlessBuffer.slice(1, 17))) === userID) {
    isValidUser = true
  }
  if (!isValidUser) {
    return {
      hasError: true,
      message: 'invalid user'
    }
  }

  const optLength = new Uint8Array(vlessBuffer.slice(17, 18))[0]
  //skip opt for now

  const command = new Uint8Array(
    vlessBuffer.slice(18 + optLength, 18 + optLength + 1)
  )[0]

  // 0x01 TCP | 0x02 UDP | 0x03 MUX
  switch (command) {
    case 1:
      break
    case 2:
      isUDP = true
      break
    case 3:
      return {
        hasError: true,
        message: `command ${command} is not support, command 01-tcp,02-udp,03-mux`
      }
  }
  const portIndex = 18 + optLength + 1
  const portBuffer = vlessBuffer.slice(portIndex, portIndex + 2)
  // port is big-Endian in raw data etc 80 == 0x005d
  const portRemote = new DataView(portBuffer).getUint16(0)

  let addressIndex = portIndex + 2
  const addressBuffer = new Uint8Array(
    vlessBuffer.slice(addressIndex, addressIndex + 1)
  )

  // 1--> ipv4  addressLength =4
  // 2--> domain name addressLength=addressBuffer[1]
  // 3--> ipv6  addressLength =16
  const addressType = addressBuffer[0]
  let addressLength = 0
  let addressValueIndex = addressIndex + 1
  let addressValue = ''
  switch (addressType) {
    case 1:
      addressLength = 4
      addressValue = new Uint8Array(
        vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)
      ).join('.')
      break
    case 2:
      addressLength = new Uint8Array(
        vlessBuffer.slice(addressValueIndex, addressValueIndex + 1)
      )[0]
      addressValueIndex += 1
      addressValue = new TextDecoder().decode(
        vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)
      )
      break
    case 3:
      addressLength = 16
      const dataView = new DataView(
        vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)
      )
      // 2001:0db8:85a3:0000:0000:8a2e:0370:7334
      const ipv6 = []
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16))
      }
      addressValue = ipv6.join(':')
      // seems no need add [] for ipv6
      break
    default:
      return {
        hasError: true,
        message: `invild  addressType is ${addressType}`
      }
  }
  if (!addressValue) {
    return {
      hasError: true,
      message: `addressValue is empty, addressType is ${addressType}`
    }
  }

  return {
    hasError: false,
    addressRemote: addressValue,
    addressType,
    portRemote,
    rawDataIndex: addressValueIndex + addressLength,
    vlessVersion: version,
    isUDP
  }
}

/**
 *
 * @param {import("@cloudflare/workers-types").Socket} remoteSocket
 * @param {import("@cloudflare/workers-types").WebSocket} webSocket
 * @param {Uint8Array} vlessResponseHeader
 * @param {(() => Promise<void>) | null} retry
 * @param {*} log
 */
async function remoteSocketToWS(
  remoteSocket,
  webSocket,
  vlessResponseHeader,
  retry,
  log
) {
  // remote--> ws
  let vlessHeader = vlessResponseHeader
  let hasIncomingData = false // check if remoteSocket has incoming data
  const webSocketWritableStream = new WritableStream({
    /** @param {Uint8Array} chunk*/
    async write(chunk) {
      hasIncomingData = true
      if (webSocket.readyState !== WS_READY_STATE_OPEN) {
        throw new Error('webSocket.readyState is not open, maybe close')
      }
      if (vlessHeader) {
        webSocket.send(new Uint8Array([...vlessHeader, ...chunk]))
        vlessHeader = null
      } else {
        webSocket.send(chunk)
      }
    },
    close() {
      log(
        `remoteConnection!.readable is close with hasIncomingData is ${hasIncomingData}`
      )
    },
    abort(reason) {
      console.error(`remoteConnection!.readable abort`, reason)
    }
  })
  await remoteSocket.readable.pipeTo(webSocketWritableStream).catch((error) => {
    console.error(`remoteSocketToWS has exception `, error.stack || error)
    safeCloseWebSocket(webSocket)
  })

  // seems is cf connect socket have error,
  // 1. Socket.closed will have error
  // 2. Socket.readable will be close without any data coming
  if (hasIncomingData === false && retry) {
    log(`retry`)
    retry()
  }
}

/**
 *
 * @param {string} base64Str
 * @returns
 */
function base64ToArrayBuffer(base64Str) {
  if (!base64Str) return { error: null }
  try {
    // go use modified Base64 for URL rfc4648 which js atob not support
    base64Str = base64Str.replace(/-/g, '+').replace(/_/g, '/')
    const decode = atob(base64Str)
    const arrayBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0))
    return { earlyData: arrayBuffer.buffer, error: null }
  } catch (error) {
    return { error }
  }
}

/**
 * This is not real UUID validation
 * @param {string} uuid
 */
function isValidUUID(uuid) {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return uuidRegex.test(uuid)
}

const WS_READY_STATE_OPEN = 1
const WS_READY_STATE_CLOSING = 2
/**
 * Normally, WebSocket will not has exceptions when close.
 * @param {import("@cloudflare/workers-types").WebSocket} socket
 */
function safeCloseWebSocket(socket) {
  try {
    if (
      socket.readyState === WS_READY_STATE_OPEN ||
      socket.readyState === WS_READY_STATE_CLOSING
    ) {
      socket.close()
    }
  } catch (error) {
    console.error('safeCloseWebSocket error', error)
  }
}

// Like: ['00', '01',...,'ff'] -> length 256
const byteToHex = []
for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 256).toString(16).slice(1))
}
function unsafeStringify(arr, offset = 0) {
  return (
    byteToHex[arr[offset + 0]] +
    byteToHex[arr[offset + 1]] +
    byteToHex[arr[offset + 2]] +
    byteToHex[arr[offset + 3]] +
    '-' +
    byteToHex[arr[offset + 4]] +
    byteToHex[arr[offset + 5]] +
    '-' +
    byteToHex[arr[offset + 6]] +
    byteToHex[arr[offset + 7]] +
    '-' +
    byteToHex[arr[offset + 8]] +
    byteToHex[arr[offset + 9]] +
    '-' +
    byteToHex[arr[offset + 10]] +
    byteToHex[arr[offset + 11]] +
    byteToHex[arr[offset + 12]] +
    byteToHex[arr[offset + 13]] +
    byteToHex[arr[offset + 14]] +
    byteToHex[arr[offset + 15]]
  ).toLowerCase()
}
function stringify(arr, offset = 0) {
  const uuid = unsafeStringify(arr, offset)
  if (!isValidUUID(uuid)) {
    throw TypeError('Stringified UUID is invalid')
  }
  return uuid
}

/**
 *
 * @param {import("@cloudflare/workers-types").WebSocket} webSocket
 * @param {Uint8Array} vlessResponseHeader
 * @param {(string) => void} log
 */
async function handleUDPOutBound(webSocket, vlessResponseHeader, log) {
  const transformStream = new TransformStream({
    /**@param {ArrayBuffer} chunk*/
    transform(chunk, controller) {
      for (let i = 0; i < chunk.byteLength; ) {
        const packetLength = new DataView(chunk.slice(i, i + 2)).getUint16(0)
        const packet = chunk.slice(i + 2, i + 2 + packetLength)
        index += 2 + packetLength
        controller.enqueue(packet)
      }
    }
  })

  transformStream.readable
    .pipeTo(
      new WritableStream({
        /**@param {ArrayBuffer} chunk  */
        async write(chunk) {
          const res = await fetch('https://1.1.1.1/dns-query', {
            method: 'POST',
            headers: { 'content-type': 'application/dns-message' },
            body: chunk
          })

          const result = await res.arrayBuffer()
          const size = result.byteLength
          if (webSocket.readyState === WS_READY_STATE_OPEN) {
            log(`doh success and dns message length is ${udpSize}`)
            webSocket.send(
              new Uint8Array([...vlessResponseHeader, ...UDPBuffer])
            )
          }
        }
      })
    )
    .catch((error) => {
      log('dns udp has error' + error)
    })

  const writer = transformStream.writable.getWriter()
  return {
    /**@param {ArrayBuffer} chunk*/
    write(chunk) {
      writer.write(chunk)
    }
  }
}

/**
 * @param {number} addressType
 * @param {string} addressRemote
 * @param {number} portRemote
 * @param {function} log The logging function.
 */
async function socks5Connect(addressType, addressRemote, portRemote, log) {
  const { username, password, hostname, port } = parsedSocks5Address
  // Connect to the SOCKS server
  const socket = connect({
    hostname,
    port
  })

  // Request head format (Worker -> Socks Server):
  // +----+----------+----------+
  // |VER | NMETHODS | METHODS  |
  // +----+----------+----------+
  // | 1  |    1     | 1 to 255 |
  // +----+----------+----------+

  // https://en.wikipedia.org/wiki/SOCKS#SOCKS5
  // For METHODS:
  // 0x00 NO AUTHENTICATION REQUIRED
  // 0x02 USERNAME/PASSWORD https://datatracker.ietf.org/doc/html/rfc1929
  const socksGreeting = new Uint8Array([5, 2, 0, 2])

  const writer = socket.writable.getWriter()

  await writer.write(socksGreeting)
  log('sent socks greeting')

  const reader = socket.readable.getReader()
  const encoder = new TextEncoder()
  let res = (await reader.read()).value
  // Response format (Socks Server -> Worker):
  // +----+--------+
  // |VER | METHOD |
  // +----+--------+
  // | 1  |   1    |
  // +----+--------+
  if (res[0] !== 0x05) {
    log(`socks server version error: ${res[0]} expected: 5`)
    return
  }
  if (res[1] === 0xff) {
    log('no acceptable methods')
    return
  }

  // if return 0x0502
  if (res[1] === 0x02) {
    log('socks server needs auth')
    if (!username || !password) {
      log('please provide username/password')
      return
    }
    // +----+------+----------+------+----------+
    // |VER | ULEN |  UNAME   | PLEN |  PASSWD  |
    // +----+------+----------+------+----------+
    // | 1  |  1   | 1 to 255 |  1   | 1 to 255 |
    // +----+------+----------+------+----------+
    const authRequest = new Uint8Array([
      1,
      username.length,
      ...encoder.encode(username),
      password.length,
      ...encoder.encode(password)
    ])
    await writer.write(authRequest)
    res = (await reader.read()).value
    // expected 0x0100
    if (res[0] !== 0x01 || res[1] !== 0x00) {
      log('fail to auth socks server')
      return
    }
  }

  // Request data format (Worker -> Socks Server):
  // +----+-----+-------+------+----------+----------+
  // |VER | CMD |  RSV  | ATYP | DST.ADDR | DST.PORT |
  // +----+-----+-------+------+----------+----------+
  // | 1  |  1  | X'00' |  1   | Variable |    2     |
  // +----+-----+-------+------+----------+----------+
  // ATYP: address type of following address
  // 0x01: IPv4 address
  // 0x03: Domain name
  // 0x04: IPv6 address
  // DST.ADDR: desired destination address
  // DST.PORT: desired destination port in network octet order

  // addressType
  // 1--> ipv4  addressLength =4
  // 2--> domain name
  // 3--> ipv6  addressLength =16
  let DSTADDR // DSTADDR = ATYP + DST.ADDR
  switch (addressType) {
    case 1:
      DSTADDR = new Uint8Array([1, ...addressRemote.split('.').map(Number)])
      break
    case 2:
      DSTADDR = new Uint8Array([
        3,
        addressRemote.length,
        ...encoder.encode(addressRemote)
      ])
      break
    case 3:
      DSTADDR = new Uint8Array([
        4,
        ...addressRemote
          .split(':')
          .flatMap((x) => [
            parseInt(x.slice(0, 2), 16),
            parseInt(x.slice(2), 16)
          ])
      ])
      break
    default:
      log(`invild  addressType is ${addressType}`)
      return
  }
  const socksRequest = new Uint8Array([
    5,
    1,
    0,
    ...DSTADDR,
    portRemote >> 8,
    portRemote & 0xff
  ])
  await writer.write(socksRequest)
  log('sent socks request')

  res = (await reader.read()).value
  // Response format (Socks Server -> Worker):
  //  +----+-----+-------+------+----------+----------+
  // |VER | REP |  RSV  | ATYP | BND.ADDR | BND.PORT |
  // +----+-----+-------+------+----------+----------+
  // | 1  |  1  | X'00' |  1   | Variable |    2     |
  // +----+-----+-------+------+----------+----------+
  if (res[1] === 0x00) {
    log('socks connection opened')
  } else {
    log('fail to open socks connection')
    return
  }
  writer.releaseLock()
  reader.releaseLock()
  return socket
}

/**
 *
 * @param {string} address
 */
function socks5AddressParser(address) {
  let [latter, former] = address.split('@').reverse()
  let username, password, hostname, port
  if (former) {
    const formers = former.split(':')
    if (formers.length !== 2) {
      throw new Error('Invalid SOCKS address format')
    }
    ;[username, password] = formers
  }
  const latters = latter.split(':')
  port = Number(latters.pop())
  if (isNaN(port)) {
    throw new Error('Invalid SOCKS address format')
  }
  hostname = latters.join(':')
  const regex = /^\[.*\]$/
  if (hostname.includes(':') && !regex.test(hostname)) {
    throw new Error('Invalid SOCKS address format')
  }
  return {
    username,
    password,
    hostname,
    port
  }
}

/**
 * 
 * @param {string} userID 
 * @param {string | null} hostName
 */
async function getCONFIG(userID, hostName, sub, RproxyIP, _url) {
    return `
    <p>===================================================配置详解=======================================================</p>
      Subscribe / sub 订阅地址, 支持 Base64、clash-meta、sing-box 订阅格式, 您的订阅内容由 ${sub} 提供维护支持, 是否使用订阅器内置ProxyIP: ${RproxyIP}.
    --------------------------------------------------------------------------------------------------------------------
      订阅地址：https://${sub}/sub?host=${hostName}&uuid=${userID}&proxyip=${RproxyIP}
    <p>=================================================================================================================</p>
      github 项目地址 Star!Star!Star!!!
      telegram 交流群 技术大佬~在线发牌!
      https://t.me/CMLiussss
    <p>=================================================================================================================</p>
    `
}
