'use client';
import React, { useEffect, useRef, useState } from 'react';
import MessageBubble from './MessageBubble';

export default function ChatWindow({ roomId, members, onSend, log, createRoom, promote, kick, mute, openDM, myId }: any){
  const [input, setInput] = useState('');
  const bodyRef = useRef<HTMLDivElement|null>(null);

  useEffect(()=>{ if(bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; },[log]);

  // determine my role in this room
  const myRole = (members || []).find((m:any)=>m.uid === myId)?.role || 'user';

  return (
    <div className="chat-wrap">
      <div className="chat-header">
        <div style={{fontWeight:700}}>{roomId || 'トークを選択'}</div>
        <div style={{marginTop:6}}>
          {members && members.map((m:any)=>(
            <span key={m.uid} style={{marginRight:8,padding:'6px 10px',background:'#fff',borderRadius:999}}>
              {m.nickname || m.uid.slice(0,6)}{m.role==='admin'?' 👑':m.role==='mod'?' 🛡':''}
              {myRole === 'admin' && m.uid !== myId && (
                <span style={{marginLeft:6}}>
                  <button onClick={()=>promote(roomId, m.uid, 'mod')} style={{marginLeft:6}}>mod</button>
                  <button onClick={()=>promote(roomId, m.uid, 'user')}>user</button>
                  <button onClick={()=>kick(roomId, m.uid)}>kick</button>
                  <button onClick={()=>mute(roomId, m.uid)}>mute</button>
                </span>
              )}
            </span>
          ))}
        </div>
      </div>

      <div className="chat-body" ref={bodyRef}>
        {log.slice().reverse().map((l:string, i:number)=>(
          <div key={i} style={{marginBottom:6}}>
            <MessageBubble text={l} isSelf={l.startsWith('you:')} />
          </div>
        ))}
      </div>

      <div className="chat-footer">
        <input className="input" value={input} onChange={e=>setInput(e.target.value)} placeholder={roomId? 'メッセージ...' : 'ルームを選択'} disabled={!roomId}
          onKeyDown={(e)=>{ if(e.key === 'Enter' && input.trim() && roomId){ onSend(input.trim()); setInput(''); } }} />
        <button className="send-btn" onClick={()=>{ if(input.trim() && roomId){ onSend(input.trim()); setInput(''); } }} disabled={!roomId}>送信</button>
      </div>
    </div>
  );
}
