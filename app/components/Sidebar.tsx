'use client';
import React, { useState } from 'react';

export default function Sidebar(props:any){
  const { nickname, setNickname, myCode, setMyCode, autoAccept, setAutoAccept, rooms, joined, joinRoom, createRoom, friends, pending, requestFriend, respondFriend } = props;
  const [codeInput, setCodeInput] = useState('');

  return (
    <div>
      <div className="brand">p2pChat</div>

      <div style={{marginTop:8}}>
        <input placeholder="ニックネーム" value={nickname} onChange={e=>setNickname(e.target.value)} style={{width:'100%',padding:8,borderRadius:8,border:'1px solid #ddd'}} />
      </div>

      <div className="section-title">マイコード</div>
      <div style={{display:'flex',gap:8,alignItems:'center'}}>
        <code style={{padding:6,background:'#f3f6f4',borderRadius:8}}>{myCode}</code>
        <button onClick={()=>{ const c = genCode(8); setMyCode(c); localStorage.setItem('p2pchat_code', c); }} style={{padding:6}}>再発行</button>
      </div>
      <div style={{marginTop:8}}><label><input type="checkbox" checked={autoAccept} onChange={e=>setAutoAccept(e.target.checked)} /> フレンド自動承認</label></div>

      <div className="section-title">公開ルーム</div>
      <div>
        {rooms.map((r:any)=> (
          <div key={r.id} className="room-btn" style={{cursor:'pointer'}} onClick={()=>joinRoom(r.id)}>
            <div>
              <div style={{fontWeight:600}}>{r.name}</div>
              <div className="small">{r.count}人 · {r.id}</div>
            </div>
            <div></div>
          </div>
        ))}
      </div>
      <div style={{marginTop:8,display:'flex',gap:8}}>
        <button onClick={()=>createRoom(true)}>＋ 公開</button>
        <button onClick={()=>createRoom(false)}>＋ グループ</button>
      </div>

      <div className="section-title">フレンド</div>
      <div>
        {friends.map((f:any)=> (
          <div key={f.uid} className="room-btn" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <div style={{fontWeight:600}}>{f.nickname}</div>
              <div className="small">code: {f.code || 'オフライン'}</div>
            </div>
            {/* DM開く handled in main via openDM from ChatWindow */}
          </div>
        ))}
      </div>

      <div style={{display:'flex',gap:8,marginTop:8}}>
        <input value={codeInput} onChange={e=>setCodeInput(e.target.value.toUpperCase())} placeholder="友達コード" style={{flex:1,padding:8,borderRadius:8}} />
        <button onClick={()=>{ if(codeInput) { requestFriend(codeInput); setCodeInput(''); } }}>追加</button>
      </div>

      {pending.length>0 && (
        <div style={{marginTop:12}}>
          <div className="section-title">承認待ち</div>
          {pending.map(p=>(
            <div key={p} style={{display:'flex',gap:6,alignItems:'center',marginTop:6}}>
              <code style={{opacity:.7}}>{p}</code>
              <button onClick={()=>respondFriend(p,true)}>承認</button>
              <button onClick={()=>respondFriend(p,false)}>拒否</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function genCode(len=8){ const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from({length:len},()=>chars[Math.floor(Math.random()*chars.length)]).join(''); }
