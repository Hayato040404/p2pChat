'use client';
import React, { useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import Sidebar from './components/Sidebar';
import ChatWindow from './components/ChatWindow';

const WS_URL = typeof window !== 'undefined' ? 
  (location.protocol === 'https:' ? `wss://${location.host}/api/ws` : `ws://${location.host}/api/ws`) : '';

export default function Page(){
  const [consentChecked, setConsentChecked] = useState(false);
  const [nickname, setNickname] = useState('');
  const [myId] = useState(() => nanoid(10));
  const [myCode, setMyCode] = useState('');
  const [autoAccept, setAutoAccept] = useState(true);

  const wsRef = useRef<WebSocket | null>(null);
  const [rooms, setRooms] = useState<any[]>([]);
  const [joined, setJoined] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [roomMembers, setRoomMembers] = useState<Record<string, any[]>>({});
  const [log, setLog] = useState<string[]>([]);
  const [friends, setFriends] = useState<any[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(()=>{
    const c = localStorage.getItem('p2pchat_consent');
    if(!c) { window.location.href = '/consent'; return; }
    setConsentChecked(true);
    const savedNick = localStorage.getItem('p2pchat_nick'); if(savedNick) setNickname(savedNick);
    const savedCode = localStorage.getItem('p2pchat_code'); if(savedCode) setMyCode(savedCode); else { const g = genCode(8); setMyCode(g); localStorage.setItem('p2pchat_code', g); }
    const savedAuto = localStorage.getItem('p2pchat_autoAccept'); setAutoAccept(savedAuto !== 'false');
  },[]);

  useEffect(()=>{ if(nickname) localStorage.setItem('p2pchat_nick', nickname); },[nickname]);
  useEffect(()=>{ localStorage.setItem('p2pchat_autoAccept', String(autoAccept)); },[autoAccept]);

  useEffect(()=>{
    if(!consentChecked || !nickname || !myCode) return;
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = ()=>{
      ws.send(JSON.stringify({type:'hello', uid: myId, nickname, myCode, autoAccept }));
      ws.send(JSON.stringify({type:'get-rooms'}));
      addLog('🟢 connected');
    };
    ws.onmessage = async (ev)=>{
      let msg:any={};
      try{ msg = JSON.parse(ev.data); }catch{}
      if(msg.type === 'rooms') setRooms(msg.rooms || []);
      if(msg.type === 'room-created'){ setJoined(prev=>Array.from(new Set([...prev, msg.room.id]))); setActive(msg.room.id); ws.send(JSON.stringify({type:'join-room', roomId: msg.room.id})); }
      if(msg.type === 'room-invite'){ addLog(`🔗 invite: ${msg.id}`); }
      if(msg.type === 'room-peers'){ for(const p of msg.peers || []) createPeerAndOffer(p.uid); }
      if(msg.type === 'room-members'){ setRoomMembers(prev => ({...prev, [msg.roomId]: msg.members })); }
      if(msg.type === 'room-history'){ // optional: append to log
        const msgs = msg.messages || [];
        msgs.forEach((m:any)=> addLog(`[history ${new Date(m.created).toLocaleString()}] ${m.sender}: ${m.text}`));
      }
      if(msg.type === 'chat-room'){ addLog(`💬 [${msg.roomId}] ${msg.nickname}: ${msg.text}`); }
      if(msg.type === 'friends') setFriends(msg.friends || []);
      if(msg.type === 'friend-pending') setPending(msg.from || []);
      if(msg.type === 'friend-request'){ setPending(prev=>Array.from(new Set([...prev, msg.from]))); addLog(`🔔 friend request from ${msg.nickname}`); }
      if(msg.type === 'signal'){ await handleSignal(msg.from, msg.payload); }
      if(msg.type === 'system') addLog(`⚠️ ${msg.text}`);
      if(msg.type === 'error') addLog(`❌ ${msg.message}`);
      if(msg.type === 'info') addLog(`ℹ️ ${msg.message}`);
    };
    ws.onclose = ()=>addLog('🔴 disconnected');
    ws.onerror = ()=>addLog('⚠️ ws error');

    return ()=>{ ws.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[consentChecked, nickname, myCode]);

  // WebRTC mesh helpers
  const pcs = useRef(new Map<string, RTCPeerConnection>());
  const dcs = useRef(new Map<string, RTCDataChannel>());
  function addLog(s:string){ setLog(prev=>[s,...prev].slice(0,500)); }
  function newPeerConnection(peerId:string){
    const pc = new RTCPeerConnection({ iceServers:[{ urls:['stun:stun.l.google.com:19302'] }] });
    pc.onicecandidate = (e)=>{ if(e.candidate) wsRef.current?.send(JSON.stringify({type:'signal', target: peerId, payload:{ type:'candidate', candidate: e.candidate }})); };
    pc.ondatachannel = (e)=>{ const dc = e.channel; dcs.current.set(peerId, dc); dc.onmessage = (ev)=>addLog(`${peerId}: ${ev.data}`); dc.onopen = ()=>addLog(`✅ p2p open ${peerId}`); dc.onclose = ()=>addLog(`❌ p2p closed ${peerId}`); };
    pcs.current.set(peerId, pc); return pc;
  }
  async function createPeerAndOffer(peerId:string){
    const pc = newPeerConnection(peerId);
    const dc = pc.createDataChannel('chat');
    dcs.current.set(peerId, dc);
    dc.onmessage = (ev)=>addLog(`${peerId}: ${ev.data}`);
    dc.onopen = ()=>addLog(`✅ p2p open ${peerId}`);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    wsRef.current?.send(JSON.stringify({type:'signal', target: peerId, payload:{ type:'offer', sdp: offer }}));
  }
  async function handleSignal(fromId:string, payload:any){
    let pc = pcs.current.get(fromId);
    if(!pc) pc = newPeerConnection(fromId);
    if(payload.type === 'offer'){
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      wsRef.current?.send(JSON.stringify({type:'signal', target: fromId, payload:{ type:'answer', sdp: answer }}));
    } else if(payload.type === 'answer'){
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    } else if(payload.type === 'candidate'){
      try{ await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); }catch{}
    }
  }

  function sendP2P(text:string){
    let sent = 0;
    dcs.current.forEach(dc=>{ if(dc.readyState === 'open'){ dc.send(text); sent++; }});
    addLog(`you: ${text} (to ${sent})`);
  }

  // actions
  function createRoom(isPublic:boolean){
    const name = prompt(isPublic? '公開ルーム名を入力' : 'グループ名（任意）') || (isPublic? '公開ルーム' : 'グループ');
    wsRef.current?.send(JSON.stringify({type:'create-room', isPublic, name}));
  }
  function joinRoom(id:string){
    setJoined(prev=>Array.from(new Set([...prev, id])));
    setActive(id);
    wsRef.current?.send(JSON.stringify({type:'join-room', roomId: id}));
  }
  function leaveRoom(id:string){
    wsRef.current?.send(JSON.stringify({type:'leave-room', roomId: id}));
    setJoined(prev=>prev.filter(r=>r!==id));
    if(active === id) setActive(null);
  }
  function promote(roomId:string, uid:string, role:string){
    wsRef.current?.send(JSON.stringify({type:'promote', roomId, target: uid, role}));
  }
  function kick(roomId:string, uid:string){
    if(!confirm('キックしてもよいですか？')) return;
    wsRef.current?.send(JSON.stringify({type:'kick', roomId, target: uid}));
  }
  function mute(roomId:string, uid:string){
    wsRef.current?.send(JSON.stringify({type:'mute', roomId, target: uid}));
  }

  // friends
  function requestFriend(code:string){ wsRef.current?.send(JSON.stringify({type:'friend-request', targetCode: code})); }
  function respondFriend(fromUid:string, accept:boolean){ wsRef.current?.send(JSON.stringify({type:'friend-respond', fromUid, accept})); }
  function openDM(friend:any){
    const peerCode = friend.code || 'OFFLINE';
    const [a,b] = [myCode, peerCode].sort();
    const dmId = `DM-${a}-${b}`;
    joinRoom(dmId);
    setActive(dmId);
  }

  const members = active ? roomMembers[active] || [] : [];

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <Sidebar
          nickname={nickname}
          setNickname={setNickname}
          myCode={myCode}
          setMyCode={(c:string)=>{ setMyCode(c); localStorage.setItem('p2pchat_code', c); }}
          autoAccept={autoAccept}
          setAutoAccept={setAutoAccept}
          rooms={rooms}
          joined={joined}
          joinRoom={joinRoom}
          createRoom={createRoom}
          friends={friends}
          pending={pending}
          requestFriend={requestFriend}
          respondFriend={respondFriend}
        />
      </aside>
      <main>
        <ChatWindow
          roomId={active}
          members={members}
          onSend={(t:string)=>sendP2P(t)}
          log={log}
          createRoom={createRoom}
          promote={promote}
          kick={kick}
          mute={mute}
          openDM={openDM}
          myId={myId}
        />
      </main>
    </div>
  );
}

function genCode(len=8){ const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from({length:len},()=>chars[Math.floor(Math.random()*chars.length)]).join(''); }
