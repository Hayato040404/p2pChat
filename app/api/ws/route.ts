export const runtime = 'edge';

// 型
type Role = 'admin' | 'mod' | 'user';
type Sock = WebSocket & {
  uid?: string;
  nickname?: string;
  myCode?: string;         // 友達コード（クライアントが生成して送ってくる）
  autoAccept?: boolean;    // フレンド自動承認
  mode?: 'public'|'group'|'direct';
  room?: string | null;
  muted?: boolean;
  role?: Role;
};

// ====== インメモリ状態（Edgeインスタンス内のみ） ======
const sockets = new Map<string, Sock>(); // uid -> socket
const code2uid = new Map<string, string>(); // myCode -> uid
const friends = new Map<string, Set<string>>(); // uid -> set(uid)
const pending = new Map<string, Set<string>>(); // uid -> set(uid) 申請待ち（from uid）

// ルーム
type Room = {
  id: string;
  name: string;
  isPublic: boolean;
  members: Set<string>;           // uid
  roles: Map<string, Role>;       // uid -> role
};
const rooms = new Map<string, Room>(); // roomId -> room

// 公開ルームの初期サンプル
function ensureDefaultRooms() {
  if (![...rooms.values()].some(r => r.isPublic)) {
    ['雑談','プログラミング','音楽好き'].forEach((name, i) => {
      const id = `PUB${i+1}`;
      rooms.set(id, { id, name, isPublic: true, members: new Set(), roles: new Map() });
    });
  }
}

// ユーティリティ
function send(ws: WebSocket, msg: any) { try { ws.send(JSON.stringify(msg)); } catch {} }
function toList<T>(s?: Set<T>) { return s ? Array.from(s) : []; }
function broadcastRoom(roomId: string, msg: any) {
  const room = rooms.get(roomId); if (!room) return;
  for (const uid of room.members) {
    const s = sockets.get(uid);
    if (s && s.readyState === s.OPEN) send(s, msg);
  }
}
function publicRoomsPayload() {
  const arr = [...rooms.values()].filter(r => r.isPublic).map(r => ({
    id: r.id, name: r.name, count: r.members.size
  }));
  return arr;
}
function getUserListForRoom(roomId: string) {
  const room = rooms.get(roomId); if (!room) return [];
  return [...room.members].map(uid => {
    const s = sockets.get(uid);
    return { uid, nickname: s?.nickname, role: room.roles.get(uid) || 'user' as Role };
  });
}
function pushFriend(a: string, b: string) {
  if (!friends.has(a)) friends.set(a, new Set());
  friends.get(a)!.add(b);
}
function isAdmin(uid: string, roomId: string) {
  const r = rooms.get(roomId); if (!r) return false;
  return r.roles.get(uid) === 'admin';
}
function isModOrAdmin(uid: string, roomId: string) {
  const r = rooms.get(roomId); if (!r) return false;
  const role = r.roles.get(uid);
  return role === 'admin' || role === 'mod';
}

ensureDefaultRooms();

// ====== WebSocket エンドポイント ======
export async function GET(req: Request) {
  if ((req.headers.get('upgrade') || '').toLowerCase() !== 'websocket') {
    return new Response('Expected websocket', { status: 426 });
  }

  const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, Sock];
  server.accept();

  server.addEventListener('message', async (ev) => {
    let data: any = {};
    try { data = JSON.parse(ev.data as string); } catch { return; }

    // 初回
    if (data.type === 'hello') {
      const { uid, nickname, myCode, autoAccept } = data;
      server.uid = uid;
      server.nickname = nickname;
      server.myCode = myCode;
      server.autoAccept = !!autoAccept;

      sockets.set(uid, server);
      if (myCode) code2uid.set(myCode, uid);

      // 公開ルーム一覧とフレンド一覧
      send(server, { type: 'rooms', rooms: publicRoomsPayload() });
      send(server, { type: 'friends', friends: toList(friends.get(uid) || new Set()).map(fid => {
        const s = sockets.get(fid);
        return { uid: fid, nickname: s?.nickname || '(オフライン)', online: !!s, code: s?.myCode || null };
      })});
      // ペンディング
      send(server, { type: 'friend-pending', from: toList(pending.get(uid)) });

      return;
    }

    // 公開ルーム一覧請求
    if (data.type === 'get-rooms') {
      send(server, { type: 'rooms', rooms: publicRoomsPayload() });
      return;
    }

    // ルーム作成
    if (data.type === 'create-room') {
      const id = data.isPublic ? `PUB${Math.random().toString(36).slice(2,8).toUpperCase()}` : (data.id || genCode());
      const room: Room = { id, name: data.name || id, isPublic: !!data.isPublic, members: new Set(), roles: new Map() };
      rooms.set(id, room);

      // 作成者をadminとして参加
      const uid = server.uid!;
      room.members.add(uid);
      room.roles.set(uid, 'admin');

      // 自分へ詳細・全員へ公開一覧更新
      send(server, { type: 'room-created', room: { id: room.id, name: room.name, isPublic: room.isPublic } });
      if (room.isPublic) {
        // 全接続に一覧更新
        sockets.forEach(s => send(s, { type: 'rooms', rooms: publicRoomsPayload() }));
      } else {
        // 招待コード（= room.id）を自分に通知
        send(server, { type: 'room-invite', id: room.id });
      }
      // メンバー一覧
      send(server, { type: 'room-members', roomId: id, members: getUserListForRoom(id) });
      return;
    }

    // ルーム参加
    if (data.type === 'join-room') {
      const { roomId } = data;
      const room = rooms.get(roomId);
      if (!room) { send(server, { type: 'error', message: 'room not found' }); return; }
      room.members.add(server.uid!);
      if (!room.roles.has(server.uid!)) room.roles.set(server.uid!, 'user');

      // 参加者に既存ピアを送る（P2Pハンドシェイク用）
      const others = [...room.members].filter(u => u !== server.uid);
      send(server, { type: 'room-peers', roomId, peers: others.map(uid => ({ uid, nickname: sockets.get(uid)?.nickname })) });

      // 既存メンバーへ新規参加者通知
      broadcastRoom(roomId, { type: 'room-join', roomId, uid: server.uid, nickname: server.nickname });

      // UI更新
      broadcastRoom(roomId, { type: 'room-members', roomId, members: getUserListForRoom(roomId) });

      return;
    }

    // ルーム退出
    if (data.type === 'leave-room') {
      const { roomId } = data;
      const room = rooms.get(roomId); if (!room) return;
      room.members.delete(server.uid!);
      broadcastRoom(roomId, { type: 'peer-left', uid: server.uid });
      broadcastRoom(roomId, { type: 'room-members', roomId, members: getUserListForRoom(roomId) });
      return;
    }

    // 役職変更（adminのみ）
    if (data.type === 'promote') {
      const { roomId, target, role } = data as { roomId: string; target: string; role: Role };
      if (!isAdmin(server.uid!, roomId)) { send(server, { type: 'error', message: 'not admin' }); return; }
      const r = rooms.get(roomId); if (!r) return;
      if (['admin','mod','user'].includes(role)) {
        r.roles.set(target, role);
        broadcastRoom(roomId, { type: 'room-members', roomId, members: getUserListForRoom(roomId) });
      }
      return;
    }

    // キック/ミュート（admin/mod）
    if (data.type === 'kick' || data.type === 'mute') {
      const { roomId, target } = data;
      if (!isModOrAdmin(server.uid!, roomId)) { send(server, { type: 'error', message: 'no permission' }); return; }
      const t = sockets.get(target);
      if (!t) return;
      if (data.type === 'kick') {
        send(t, { type: 'system', text: `You were kicked from ${roomId}` });
        const r = rooms.get(roomId); r?.members.delete(target);
        t.close();
      } else {
        (t as Sock).muted = true;
        send(t, { type: 'system', text: `You were muted in ${roomId}` });
      }
      broadcastRoom(roomId, { type: 'room-members', roomId, members: getUserListForRoom(roomId) });
      return;
    }

    // 公開ロビーのWSチャット（任意）
    if (data.type === 'chat-room') {
      const { roomId, text } = data;
      const r = rooms.get(roomId); if (!r) return;
      if ((server as Sock).muted) return;
      broadcastRoom(roomId, { type: 'chat-room', roomId, from: server.uid, nickname: server.nickname, text, ts: Date.now() });
      return;
    }

    // ==== フレンド機能 ====
    if (data.type === 'friend-request') {
      const { targetCode } = data;
      const targetUid = code2uid.get(targetCode);
      if (!targetUid) { send(server, { type: 'error', message: '相手がオフラインか存在しません' }); return; }
      const targetSock = sockets.get(targetUid)!;

      // 既に友達ならスキップ
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

    // ====== WebRTCシグナリング ======
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
    // ルームからの削除
    rooms.forEach(r => {
      if (r.members.delete(uid)) {
        broadcastRoom(r.id, { type: 'peer-left', uid });
        broadcastRoom(r.id, { type: 'room-members', roomId: r.id, members: getUserListForRoom(r.id) });
      }
    });
  });

  return new Response(null, { status: 101, webSocket: client });
}

// helpers
function genCode(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
function friendPayload(uid: string) {
  const arr = toList(friends.get(uid) || new Set());
  return arr.map(fid => {
    const s = sockets.get(fid);
    return { uid: fid, nickname: s?.nickname || '(オフライン)', online: !!s, code: s?.myCode || null };
  });
}
