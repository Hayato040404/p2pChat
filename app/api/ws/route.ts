export const runtime = 'edge';

// ----- 型 -----
type Role = 'admin'|'mod'|'user';
type Sock = WebSocket & {
  uid?: string;
  nickname?: string;
  myCode?: string;
  autoAccept?: boolean;
  mode?: string;
  room?: string|null;
  muted?: boolean;
  role?: Role;
};

// ----- インメモリ状態 -----
const sockets = new Map<string, Sock>();           // uid -> socket
const code2uid = new Map<string, string>();       // myCode -> uid
const friends = new Map<string, Set<string>>();   // uid -> set(uid)
const pending = new Map<string, Set<string>>();   // uid -> set(uid) for incoming requests

// rooms & messages
type Room = {
  id: string;
  name: string;
  isPublic: boolean;
  members: Set<string>;
  roles: Map<string, Role>;
};
const rooms = new Map<string, Room>();
const messages = new Map<string, { id: string; roomId: string; sender: string; text: string; created: number }[]>();

// ensure default public rooms
function ensureDefaultRooms(){
  if ([...rooms.values()].filter(r => r.isPublic).length === 0) {
    ['雑談','プログラミング','音楽好き'].forEach((name, i) => {
      const id = `PUB${i+1}`;
      rooms.set(id, { id, name, isPublic: true, members: new Set(), roles: new Map() });
      messages.set(id, []);
    });
  }
}
ensureDefaultRooms();

// ----- ユーティリティ -----
function now(){ return Date.now(); }
function send(ws: WebSocket, msg: any){ try{ ws.send(JSON.stringify(msg)); }catch{} }
function toList<T>(s?: Set<T>){ return s ? Array.from(s) : [] }
function publicRoomsPayload(){ return [...rooms.values()].filter(r => r.isPublic).map(r => ({ id: r.id, name: r.name, count: r.members.size })); }
function getUserListForRoom(roomId: string){ const r = rooms.get(roomId); if(!r) return []; return [...r.members].map(uid => { const s = sockets.get(uid); return { uid, nickname: s?.nickname, role: r.roles.get(uid) || 'user' as Role }; }); }
function broadcastRoom(roomId: string, msg: any){ const r = rooms.get(roomId); if(!r) return; for(const uid of r.members){ const s = sockets.get(uid); if(s && s.readyState === s.OPEN) send(s, msg); } }
function pushFriend(a: string, b: string){ if(!friends.has(a)) friends.set(a, new Set()); friends.get(a)!.add(b); }
function friendPayload(uid: string) {
  // friends は Map<string, Set<string>> 型
  const arr = Array.from(friends.get(uid) ?? new Set<string>());

  return arr.map((fid: string) => {
    const s = sockets.get(fid);
    return {
      uid: fid,
      nickname: s?.nickname || '(オフライン)',
      online: !!s,
      code: s?.myCode || null
    };
  });
}

function genCode(len = 6){ const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
function isAdmin(uid: string, roomId: string){ const r = rooms.get(roomId); if(!r) return false; return r.roles.get(uid) === 'admin'; }
function isModOrAdmin(uid: string, roomId: string){ const r = rooms.get(roomId); if(!r) return false; const role = r.roles.get(uid); return role === 'admin' || role === 'mod'; }

// ----- メッセージ古いもの自動削除（3日） -----
setInterval(()=>{
  const cutoff = Date.now() - 3*24*60*60*1000;
  messages.forEach((arr, roomId) => {
    messages.set(roomId, arr.filter(m => m.created >= cutoff));
  });
}, 60*60*1000); // hourly

// ----- WebSocket エンドポイント -----
export async function GET(req: Request){
  if ((req.headers.get('upgrade') || '').toLowerCase() !== 'websocket') {
    return new Response('Expected websocket', { status: 426 });
  }

  const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, Sock];
  server.accept();

  server.addEventListener('message', (ev) => {
    let data: any = {};
    try { data = JSON.parse(ev.data as string); } catch { return; }

    // --- hello ---
    if (data.type === 'hello') {
      const { uid, nickname, myCode, autoAccept } = data;
      server.uid = uid;
      server.nickname = nickname;
      server.myCode = myCode;
      server.autoAccept = !!autoAccept;

      sockets.set(uid, server);
      if (myCode) code2uid.set(myCode, uid);

      // send initial state
      send(server, { type: 'rooms', rooms: publicRoomsPayload() });
      send(server, { type: 'friends', friends: friendPayload(uid) });
      send(server, { type: 'friend-pending', from: toList(pending.get(uid)) });
      return;
    }

    // --- get-rooms ---
    if (data.type === 'get-rooms') {
      send(server, { type: 'rooms', rooms: publicRoomsPayload() });
      return;
    }

    // --- create-room ---
    if (data.type === 'create-room') {
      const id = data.isPublic ? `PUB${Math.random().toString(36).slice(2,8).toUpperCase()}` : (data.id || genCode());
      const room: Room = { id, name: data.name || id, isPublic: !!data.isPublic, members: new Set(), roles: new Map() };
      rooms.set(id, room);
      messages.set(id, []);
      const uid = server.uid!;
      room.members.add(uid);
      room.roles.set(uid, 'admin');

      send(server, { type: 'room-created', room: { id: room.id, name: room.name, isPublic: room.isPublic } });
      if (room.isPublic) {
        sockets.forEach(s => { if (s.readyState === s.OPEN) send(s, { type: 'rooms', rooms: publicRoomsPayload() }); });
      } else {
        send(server, { type: 'room-invite', id: room.id });
      }
      send(server, { type: 'room-members', roomId: id, members: getUserListForRoom(id) });
      return;
    }

    // --- join-room ---
    if (data.type === 'join-room') {
      const { roomId } = data;
      const room = rooms.get(roomId);
      if (!room) { send(server, { type: 'error', message: 'room not found' }); return; }
      room.members.add(server.uid!);
      if (!room.roles.has(server.uid!)) room.roles.set(server.uid!, 'user');

      const others = [...room.members].filter(u => u !== server.uid);
      send(server, { type: 'room-peers', roomId, peers: others.map(uid => ({ uid, nickname: sockets.get(uid)?.nickname })) });

      broadcastRoom(roomId, { type: 'room-join', roomId, uid: server.uid, nickname: server.nickname });

      send(server, { type: 'room-members', roomId, members: getUserListForRoom(roomId) });

      // send recent messages to joiner
      const msgs = (messages.get(roomId) || []).slice(-200);
      send(server, { type: 'room-history', roomId, messages: msgs });
      return;
    }

    // --- leave-room ---
    if (data.type === 'leave-room') {
      const { roomId } = data;
      const room = rooms.get(roomId); if (!room) return;
      room.members.delete(server.uid!);
      broadcastRoom(roomId, { type: 'peer-left', uid: server.uid });
      send(server, { type: 'room-members', roomId, members: getUserListForRoom(roomId) });
      return;
    }

    // --- promote ---
    if (data.type === 'promote') {
      const { roomId, target, role } = data as { roomId: string; target: string; role: Role };
      const r = rooms.get(roomId); if (!r) { send(server, { type: 'error', message: 'room not found' }); return; }
      if (r.roles.get(server.uid!) !== 'admin') { send(server, { type: 'error', message: 'not admin' }); return; }
      if (['admin','mod','user'].includes(role)) {
        r.roles.set(target, role);
        broadcastRoom(roomId, { type: 'room-members', roomId, members: getUserListForRoom(roomId) });
      }
      return;
    }

    // --- kick / mute ---
    if (data.type === 'kick' || data.type === 'mute') {
      const { roomId, target } = data;
      const r = rooms.get(roomId); if (!r) return;
      const role = r.roles.get(server.uid!);
      if (!(role === 'admin' || role === 'mod')) { send(server, { type: 'error', message: 'no permission' }); return; }
      const t = sockets.get(target);
      if (!t) return;
      if (data.type === 'kick') {
        send(t, { type: 'system', text: `You were kicked from ${roomId}` });
        r.members.delete(target);
        try { t.close(); } catch {}
      } else {
        (t as Sock).muted = true;
        send(t, { type: 'system', text: `You were muted in ${roomId}` });
      }
      broadcastRoom(roomId, { type: 'room-members', roomId, members: getUserListForRoom(roomId) });
      return;
    }

    // --- chat-room (save history + broadcast) ---
    if (data.type === 'chat-room') {
      const { roomId, text } = data;
      const r = rooms.get(roomId); if (!r) return;
      if ((server as Sock).muted) return;
      const rec = { id: Math.random().toString(36).slice(2), roomId, sender: server.uid!, text, created: Date.now() };
      if (!messages.has(roomId)) messages.set(roomId, []);
      messages.get(roomId)!.push(rec);
      // trim older than 3 days
      const cutoff = Date.now() - 3*24*60*60*1000;
      messages.set(roomId, (messages.get(roomId) || []).filter(m => m.created >= cutoff));
      broadcastRoom(roomId, { type: 'chat-room', roomId, from: server.uid, nickname: server.nickname, text, ts: Date.now() });
      return;
    }

    // --- friend-request ---
    if (data.type === 'friend-request') {
      const { targetCode } = data;
      const targetUid = code2uid.get(targetCode);
      if (!targetUid) { send(server, { type: 'error', message: '相手が見つかりません' }); return; }
      const targetSock = sockets.get(targetUid)!;
      const setA = friends.get(server.uid!) || new Set();
      if (setA.has(targetUid)) { send(server, { type: 'info', message: '既にフレンドです' }); return; }

      if (targetSock.autoAccept) {
        pushFriend(server.uid!, targetUid);
        pushFriend(targetUid, server.uid!);
        send(server, { type: 'friends', friends: friendPayload(server.uid!) });
        send(targetSock, { type: 'friends', friends: friendPayload(targetUid) });
      } else {
        if (!pending.has(targetUid)) pending.set(targetUid, new Set());
        pending.get(targetUid)!.add(server.uid!);
        send(targetSock, { type: 'friend-request', from: server.uid, nickname: server.nickname, code: server.myCode });
        send(server, { type: 'info', message: '申請を送信しました（相手の承認待ち）' });
      }
      return;
    }

    if (data.type === 'friend-respond') {
      const { fromUid, accept } = data;
      const set = pending.get(server.uid!) || new Set();
      if (!set.has(fromUid)) return;
      set.delete(fromUid);
      if (accept) {
        pushFriend(server.uid!, fromUid);
        pushFriend(fromUid, server.uid!);
        const other = sockets.get(fromUid);
        if (other) send(other, { type: 'friends', friends: friendPayload(fromUid) });
        send(server, { type: 'friends', friends: friendPayload(server.uid!) });
      } else {
        send(server, { type: 'info', message: '申請を拒否しました' });
      }
      send(server, { type: 'friend-pending', from: toList(set) });
      return;
    }

    if (data.type === 'get-friends') {
      send(server, { type: 'friends', friends: friendPayload(server.uid!) });
      return;
    }

    // --- signaling ---
    if (data.type === 'signal' && data.target) {
      const target = sockets.get(data.target);
      if (target && target.readyState === target.OPEN) {
        send(target, { type: 'signal', from: server.uid, payload: data.payload });
      }
      return;
    }
  });

  server.addEventListener('close', () => {
    const uid = server.uid!;
    sockets.delete(uid);
    if (server.myCode) code2uid.delete(server.myCode);
    rooms.forEach(r => {
      if (r.members.delete(uid)) {
        broadcastRoom(r.id, { type: 'peer-left', uid });
        broadcastRoom(r.id, { type: 'room-members', roomId: r.id, members: getUserListForRoom(r.id) });
      }
    });
  });

  return new Response(null, { status: 101, webSocket: client });
}
