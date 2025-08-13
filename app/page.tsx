"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";

type Role = "admin" | "mod" | "user";
type OnlineUser = { uid: string; nickname: string; role?: Role };

const WS_URL = typeof window !== 'undefined'
  ? (location.protocol === 'https:' ? `wss://${location.host}/api/ws` : `ws://${location.host}/api/ws`)
  : '';

function genCode(len = 8) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export default function Page() {
  // 基本プロフィール
  const [nickname, setNickname] = useState("");
  const [myId] = useState(() => nanoid(10));
  const [myCode, setMyCode] = useState("");
  const [autoAccept, setAutoAccept] = useState(true);

  // 接続
  const wsRef = useRef<WebSocket | null>(null);
  const [rooms, setRooms] = useState<{id:string; name:string; count:number}[]>([]);
  const [joinedRooms, setJoinedRooms] = useState<string[]>([]);
  const [activeRoom, setActiveRoom] = useState<string | null>(null);
  const [roomMembers, setRoomMembers] = useState<Record<string, OnlineUser[]>>({});
  const [log, setLog] = useState<string[]>([]);

  // WebRTC
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const dcsRef = useRef<Map<string, RTCDataChannel>>(new Map());

  // テキスト
  const [input, setInput] = useState("");

  // フレンド
  const [friends, setFriends] = useState<{uid:string; nickname:string; online:boolean; code:string|null}[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [addCode, setAddCode] = useState("");

  function addLog(s: string) { setLog(prev => [s, ...prev].slice(0, 300)); }

  // URLパラメータ
  useEffect(() => {
    const url = new URL(window.location.href);
    const name = url.searchParams.get("name");
    const pmode = url.searchParams.get("mode") || "";
    const proom = url.searchParams.get("room") || "";
    if (name) setNickname(name);
    // 事前指定：後でjoin-room呼ぶ
    if (pmode && proom) {
      setJoinedRooms(prev => Array.from(new Set([...prev, proom])));
      setActiveRoom(proom);
    }
  }, []);

  // ローカル保存のロード
  useEffect(() => {
    const savedNick = localStorage.getItem("p2pchat_nick"); if (savedNick) setNickname(savedNick);
    const savedCode = localStorage.getItem("p2pchat_code"); if (savedCode) setMyCode(savedCode); else setMyCode(genCode());
    const savedAccept = localStorage.getItem("p2pchat_autoAccept"); if (savedAccept) setAutoAccept(savedAccept === "true");
  }, []);

  useEffect(() => { if (nickname) localStorage.setItem("p2pchat_nick", nickname); }, [nickname]);
  useEffect(() => { if (myCode) localStorage.setItem("p2pchat_code", myCode); }, [myCode]);
  useEffect(() => { localStorage.setItem("p2pchat_autoAccept", String(autoAccept)); }, [autoAccept]);

  // WS接続
  useEffect(() => {
    if (!nickname || !myCode) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'hello', uid: myId, nickname, myCode, autoAccept }));
      addLog(`🟢 connected as ${nickname} (${myId})`);
      ws.send(JSON.stringify({ type: 'get-rooms' }));
      // URLで指定済みならjoin
      if (activeRoom) ws.send(JSON.stringify({ type: 'join-room', roomId: activeRoom }));
    };
    ws.onmessage = async (ev) => {
      let msg: any = {}; try { msg = JSON.parse(ev.data); } catch { return; }

      if (msg.type === 'rooms') setRooms(msg.rooms || []);
      if (msg.type === 'room-created') {
        setJoinedRooms(prev => Array.from(new Set([...prev, msg.room.id])));
        setActiveRoom(msg.room.id);
        // 参加宣言
        ws.send(JSON.stringify({ type: 'join-room', roomId: msg.room.id }));
      }
      if (msg.type === 'room-invite') {
        addLog(`🔗 招待コード: ${msg.id}`);
      }
      if (msg.type === 'room-peers') {
        // 既存ピアへ自分からOffer
        for (const p of msg.peers || []) createPeerAndOffer(p.uid);
      }
      if (msg.type === 'new-peer' || msg.type === 'room-join') {
        addLog(`🔔 join: ${msg.nickname || msg.uid}`);
      }
      if (msg.type === 'peer-left') {
        const pc = pcsRef.current.get(msg.uid); pc?.close();
        pcsRef.current.delete(msg.uid); dcsRef.current.delete(msg.uid);
        addLog(`👋 left: ${msg.uid}`);
      }
      if (msg.type === 'room-members') {
        setRoomMembers(prev => ({ ...prev, [msg.roomId]: msg.members }));
      }
      if (msg.type === 'chat-room') {
        addLog(`💬 [${msg.roomId}] ${msg.nickname}: ${msg.text}`);
      }
      if (msg.type === 'signal') {
        await handleSignal(msg.from, msg.payload);
      }
      if (msg.type === 'system') addLog(`⚠️ ${msg.text}`);
      if (msg.type === 'error') addLog(`❌ ${msg.message}`);
      if (msg.type === 'info') addLog(`ℹ️ ${msg.message}`);

      // friends
      if (msg.type === 'friends') setFriends(msg.friends || []);
      if (msg.type === 'friend-pending') setPending(msg.from || []);
      if (msg.type === 'friend-request') {
        // 手動承認モードの相手から届く
        setPending(prev => Array.from(new Set([...prev, msg.from])));
        addLog(`🔔 フレンド申請: ${msg.nickname}（code: ${msg.code}）`);
      }
    };
    ws.onclose = () => addLog('🔴 disconnected');
    ws.onerror = () => addLog('⚠️ ws error');

    return () => { ws.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nickname, myCode, autoAccept]);

  // WebRTC 基本
  function newPeerConnection(peerId: string) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] });
    pc.onicecandidate = (e) => { if (e.candidate) wsRef.current?.send(JSON.stringify({ type: 'signal', target: peerId, payload: { type: 'candidate', candidate: e.candidate } })); };
    pc.ondatachannel = (e) => {
      const dc = e.channel;
      dcsRef.current.set(peerId, dc);
      dc.onmessage = (ev) => addLog(`👤 ${peerId}: ${ev.data}`);
      dc.onopen = () => addLog(`✅ P2P open with ${peerId}`);
      dc.onclose = () => addLog(`❌ P2P closed with ${peerId}`);
    };
    pcsRef.current.set(peerId, pc);
    return pc;
  }
  async function createPeerAndOffer(peerId: string) {
    const pc = newPeerConnection(peerId);
    const dc = pc.createDataChannel("chat");
    dcsRef.current.set(peerId, dc);
    dc.onmessage = (ev) => addLog(`👤 ${peerId}: ${ev.data}`);
    dc.onopen = () => addLog(`✅ P2P open with ${peerId}`);
    dc.onclose = () => addLog(`❌ P2P closed with ${peerId}`);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    wsRef.current?.send(JSON.stringify({ type: 'signal', target: peerId, payload: { type: 'offer', sdp: offer } }));
  }
  async function handleSignal(fromId: string, payload: any) {
    let pc = pcsRef.current.get(fromId); if (!pc) pc = newPeerConnection(fromId);
    if (payload.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
      wsRef.current?.send(JSON.stringify({ type: 'signal', target: fromId, payload: { type: 'answer', sdp: answer } }));
    } else if (payload.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    } else if (payload.type === 'candidate') {
      try { await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch {}
    }
  }

  // 送信（P2P）
  function sendP2P(text: string) {
    let sent = 0;
    dcsRef.current.forEach(dc => { if (dc.readyState === 'open') { dc.send(text); sent++; } });
    addLog(`🗣️ you: ${text}${sent?` (to ${sent})`:''}`);
  }

  // ルーム操作
  function createRoom(isPublic: boolean) {
    const name = isPublic ? prompt("公開ルーム名を入力") || "新しい公開ルーム" : prompt("グループ名（任意）") || "新しいグループ";
    wsRef.current?.send(JSON.stringify({ type: 'create-room', isPublic, name }));
  }
  function joinRoom(id: string) {
    setJoinedRooms(prev => Array.from(new Set([...prev, id])));
    setActiveRoom(id);
    wsRef.current?.send(JSON.stringify({ type: 'join-room', roomId: id }));
  }
  function leaveRoom(id: string) {
    wsRef.current?.send(JSON.stringify({ type: 'leave-room', roomId: id }));
    setJoinedRooms(prev => prev.filter(r => r !== id));
    if (activeRoom === id) setActiveRoom(joinedRooms.find(r => r !== id) || null);
  }

  // 権限操作
  function promote(roomId: string, uid: string, role: Role) {
    wsRef.current?.send(JSON.stringify({ type: 'promote', roomId, target: uid, role }));
  }
  function kick(roomId: string, uid: string) {
    if (!confirm("キックしますか？")) return;
    wsRef.current?.send(JSON.stringify({ type: 'kick', roomId, target: uid }));
  }
  function mute(roomId: string, uid: string) {
    wsRef.current?.send(JSON.stringify({ type: 'mute', roomId, target: uid }));
  }

  // フレンド
  function requestFriend() {
    if (!addCode.trim()) return;
    wsRef.current?.send(JSON.stringify({ type: 'friend-request', targetCode: addCode.trim().toUpperCase() }));
    setAddCode("");
  }
  function respondFriend(fromUid: string, accept: boolean) {
    wsRef.current?.send(JSON.stringify({ type: 'friend-respond', fromUid, accept }));
  }
  // DM開始（安定ID：myCodeと相手codeの辞書順）
  function openDM(friend: {uid:string; code:string|null}) {
    const peerCode = friend.code || "OFFLINE";
    const [a,b] = [myCode, peerCode].sort();
    const dmId = `DM-${a}-${b}`;
    joinRoom(dmId);
    setActiveRoom(dmId);
  }

  // UI
  const members = activeRoom ? (roomMembers[activeRoom] || []) : [];
  const myRole = (members.find(m => m.uid === myId)?.role || 'user') as Role;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", height: "100vh" }}>
      {/* ---- Sidebar ---- */}
      <div style={{ borderRight: "1px solid #1f2937", padding: 12, overflow: "auto" }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>p2pChat</div>
          <div style={{ marginTop: 8 }}>
            <label>ニックネーム：</label>
            <input value={nickname} onChange={e=>setNickname(e.target.value)} placeholder="なまえ" style={{ width: "100%", padding: 8 }} />
          </div>
          <div style={{ marginTop: 8 }}>
            <div>マイコード：<code>{myCode}</code></div>
            <button onClick={()=>{ const c = genCode(); setMyCode(c); }}>コード再発行</button>
          </div>
          <div style={{ marginTop: 8 }}>
            <label><input type="checkbox" checked={autoAccept} onChange={e=>setAutoAccept(e.target.checked)} /> フレンド自動承認</label>
          </div>
        </div>

        {/* 公開ルーム */}
        <div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>公開ルーム</div>
          <div style={{ display: "grid", gap: 6 }}>
            {rooms.map(r => (
              <button key={r.id} onClick={()=>joinRoom(r.id)} style={{ textAlign: "left", padding: 8, border: "1px solid #1f2937", background: activeRoom===r.id?"#1f2937":"#111827", borderRadius: 8 }}>
                <div>{r.name}</div>
                <div style={{ opacity:.7, fontSize: 12 }}>{r.id} · {r.count}人</div>
              </button>
            ))}
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button onClick={()=>createRoom(true)}>＋ 公開ルーム</button>
            <button onClick={()=>createRoom(false)}>＋ グループ</button>
          </div>
        </div>

        {/* 参加中ルーム */}
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>参加中</div>
          {joinedRooms.length === 0 && <div style={{ opacity:.7 }}>まだありません</div>}
          {joinedRooms.map(id => (
            <div key={id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid #1f2937", padding: 6, borderRadius: 8, marginBottom: 6 }}>
              <div style={{ cursor: "pointer" }} onClick={()=>setActiveRoom(id)}>{id}</div>
              <button onClick={()=>leaveRoom(id)}>退出</button>
            </div>
          ))}
        </div>

        {/* フレンド */}
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>フレンド</div>
          <div style={{ display: "grid", gap: 6 }}>
            {friends.map(f => (
              <button key={f.uid} onClick={()=>openDM(f)} style={{ textAlign: "left", padding: 8, border: "1px solid #1f2937", background: "#0f172a", borderRadius: 8 }}>
                <div>{f.nickname} {f.online ? "🟢" : "⚪️"}</div>
                <div style={{ opacity:.7, fontSize: 12 }}>code: {f.code || "オフライン"}</div>
              </button>
            ))}
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
            <input value={addCode} onChange={e=>setAddCode(e.target.value.toUpperCase())} placeholder="友達コード" style={{ flex: 1, padding: 8 }} />
            <button onClick={requestFriend}>追加</button>
          </div>

          {pending.length>0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 600 }}>申請承認</div>
              {pending.map(uid=>(
                <div key={uid} style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
                  <code style={{ opacity:.7 }}>{uid.slice(0,6)}…</code>
                  <button onClick={()=>respondFriend(uid, true)}>承認</button>
                  <button onClick={()=>respondFriend(uid, false)}>拒否</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ---- Main Chat ---- */}
      <div style={{ display: "grid", gridTemplateRows: "auto 1fr auto", height: "100vh" }}>
        {/* ヘッダ */}
        <div style={{ padding: 12, borderBottom: "1px solid #1f2937" }}>
          <div style={{ fontWeight: 600 }}>
            {activeRoom ? `Room: ${activeRoom}` : "ルームを選択してください"}
          </div>
          {activeRoom && (
            <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {members.map(m => (
                <div key={m.uid} style={{ padding: "2px 8px", border: "1px solid #1f2937", borderRadius: 999 }}>
                  {m.nickname || m.uid.slice(0,6)}
                  {m.role === "admin" && " 👑"}
                  {m.role === "mod" && " 🛡️"}
                  {myRole !== "user" && m.uid !== myId && (
                    <>
                      <button onClick={()=>promote(activeRoom, m.uid, "mod")} style={{ marginLeft: 6 }}>mod</button>
                      <button onClick={()=>promote(activeRoom, m.uid, "user")}>user</button>
                      <button onClick={()=>kick(activeRoom, m.uid)}>kick</button>
                      <button onClick={()=>mute(activeRoom, m.uid)}>mute</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ログ */}
        <div style={{ padding: 12, overflow: "auto", whiteSpace: "pre-wrap" }}>
          {log.slice().reverse().map((l,i)=> (<div key={i} style={{ padding: "4px 0" }}>{l}</div>))}
        </div>

        {/* 入力 */}
        <div style={{ padding: 12, borderTop: "1px solid #1f2937", display: "flex", gap: 8 }}>
          <input
            value={input}
            onChange={e=>setInput(e.target.value)}
            placeholder={activeRoom ? "メッセージ…" : "まずルームを選択"}
            style={{ flex: 1, padding: 10 }}
            onKeyDown={(e)=>{ if(e.key==='Enter' && input.trim() && activeRoom){ sendP2P(input); setInput(''); } }}
            disabled={!activeRoom}
          />
          <button onClick={()=>{ if(input.trim() && activeRoom){ sendP2P(input); setInput(''); } }} disabled={!activeRoom}>送信</button>
        </div>
      </div>
    </div>
  );
}
