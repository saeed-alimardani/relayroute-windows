import net from 'node:net';
import { pathToFileURL } from 'node:url';

export function decodeSocksDestination(packet) {
  if (packet.length < 4) return null;
  if (packet[0] !== 5 || packet[1] !== 1 || packet[2] !== 0) throw new Error('Unsupported SOCKS command');
  const type = packet[3];
  let host; let offset;
  if (type === 1) {
    if (packet.length < 10) return null;
    host = [...packet.subarray(4, 8)].join('.');
    offset = 8;
  } else if (type === 3) {
    if (packet.length < 5) return null;
    const length = packet[4];
    if (length === 0 || length > 253) throw new Error('Invalid domain length');
    if (packet.length < 7 + length) return null;
    host = packet.subarray(5, 5 + length).toString('utf8');
    offset = 5 + length;
    if (!/^[a-z\d.-]+$/i.test(host)) throw new Error('Invalid domain');
  } else if (type === 4) {
    if (packet.length < 22) return null;
    const bytes = packet.subarray(4, 20);
    const groups = [];
    for (let i = 0; i < 16; i += 2) groups.push(bytes.readUInt16BE(i).toString(16));
    host = '[' + groups.join(':') + ']';
    offset = 20;
  } else throw new Error('Unsupported SOCKS destination type');
  const port = packet.readUInt16BE(offset);
  if (!port) throw new Error('Invalid port');
  return { host, port, length: offset + 2 };
}

export function createSocksServer({ httpProxyPort = 18080 } = {}) {
  return net.createServer(client => {
    let stage = 'greeting';
    let data = Buffer.alloc(0);
    let bridge;
    let answered = false;
    let header = Buffer.alloc(0);
    const fail = () => {
      if (!answered && stage === 'connect' && !client.destroyed) {
        client.end(Buffer.from([5, 1, 0, 1, 0, 0, 0, 0, 0, 0]));
      } else client.destroy();
      bridge?.destroy();
    };
    client.setTimeout(20000, fail);
    client.on('error', () => bridge?.destroy());
    client.on('close', () => bridge?.destroy());
    const onData = chunk => {
      if (stage === 'tunnel') return;
      data = Buffer.concat([data, chunk]);
      if (data.length > 1024) return fail();
      try {
        if (stage === 'greeting') {
          if (data.length < 2 || data.length < 2 + data[1]) return;
          if (data[0] !== 5 || !data.subarray(2, 2 + data[1]).includes(0)) return fail();
          data = data.subarray(2 + data[1]);
          stage = 'connect';
          client.write(Buffer.from([5, 0]));
        }
        if (stage !== 'connect') return;
        const destination = decodeSocksDestination(data);
        if (!destination) return;
        const extra = data.subarray(destination.length);
        const authority = destination.host + ':' + destination.port;
        stage = 'waiting';
        client.off('data', onData);
        bridge = net.connect(httpProxyPort, '127.0.0.1');
        bridge.once('connect', () => bridge.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`));
        bridge.on('error', fail);
        bridge.on('data', function onHeader(chunk) {
          header = Buffer.concat([header, chunk]);
          if (header.length > 8192) return fail();
          const end = header.indexOf('\r\n\r\n');
          if (end < 0) return;
          bridge.off('data', onHeader);
          const firstLine = header.subarray(0, header.indexOf('\r\n')).toString('latin1');
          if (!/^HTTP\/1\.[01] 200(?:\s|$)/.test(firstLine)) return fail();
          answered = true;
          stage = 'tunnel';
          client.setTimeout(0);
          client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
          if (extra.length) bridge.write(extra);
          if (header.length > end + 4) client.write(header.subarray(end + 4));
          client.pipe(bridge);
          bridge.pipe(client);
        });
      } catch { fail(); }
    };
    client.on('data', onData);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createSocksServer().listen(18081, '127.0.0.1', () => {
    console.log('Local SOCKS5 bridge ready on 127.0.0.1:18081');
  });
}
