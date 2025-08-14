'use client';
import React, { useState } from 'react';

export default function Sidebar(props: any) {
  const { 
    nickname, setNickname, myCode, setMyCode, autoAccept, setAutoAccept, 
    rooms, joined, joinRoom, createRoom, friends, pending, requestFriend, respondFriend 
  } = props;
  const [codeInput, setCodeInput] = useState('');

  const getInitials = (name: string) => {
    return name ? name.charAt(0).toUpperCase() : '?';
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="brand">💬 p2pChat</div>
        
        <div className="user-info">
          <div className="avatar">
            {getInitials(nickname)}
          </div>
          <input 
            className="nickname-input"
            placeholder="ニックネーム" 
            value={nickname} 
            onChange={e => setNickname(e.target.value)}
          />
        </div>

        <div className="my-code">
          <span>ID: {myCode}</span>
          <button 
            className="code-regenerate"
            onClick={() => { 
              const c = genCode(8); 
              setMyCode(c); 
              localStorage.setItem('p2pchat_code', c); 
            }}
          >
            🔄
          </button>
        </div>

        <div className="toggle-container">
          <div 
            className={`toggle ${autoAccept ? 'active' : ''}`}
            onClick={() => setAutoAccept(!autoAccept)}
          >
            <div className="toggle-slider"></div>
          </div>
          <span className="toggle-label">自動承認</span>
        </div>
      </div>

      <div className="sidebar-content">
        <div className="section-title">公開ルーム</div>
        {rooms.map((r: any) => (
          <div 
            key={r.id} 
            className={`chat-item ${joined.includes(r.id) ? 'active' : ''}`}
            onClick={() => joinRoom(r.id)}
          >
            <div className="chat-avatar">
              {r.name.charAt(0)}
            </div>
            <div className="chat-info">
              <div className="chat-name">{r.name}</div>
              <div className="chat-preview">公開チャット</div>
            </div>
            <div className="chat-meta">
              <div className="member-count">{r.count}人</div>
            </div>
          </div>
        ))}

        <div className="action-buttons">
          <button className="btn btn-primary" onClick={() => createRoom(true)}>
            ➕ 公開
          </button>
          <button className="btn btn-secondary" onClick={() => createRoom(false)}>
            👥 グループ
          </button>
        </div>

        <div className="section-title">フレンド</div>
        {friends.map((f: any) => (
          <div key={f.uid} className="chat-item">
            <div className="chat-avatar">
              {getInitials(f.nickname)}
            </div>
            <div className="chat-info">
              <div className="chat-name">{f.nickname}</div>
              <div className="chat-preview">
                {f.online ? '🟢 オンライン' : '⚫ オフライン'}
              </div>
            </div>
          </div>
        ))}

        <div className="friend-request">
          <input 
            className="friend-input"
            value={codeInput} 
            onChange={e => setCodeInput(e.target.value.toUpperCase())} 
            placeholder="友達のIDを入力" 
          />
          <button 
            className="btn btn-primary"
            onClick={() => { 
              if (codeInput) { 
                requestFriend(codeInput); 
                setCodeInput(''); 
              } 
            }}
          >
            追加
          </button>
        </div>

        {pending.length > 0 && (
          <div className="pending-requests">
            <div className="section-title">承認待ち</div>
            {pending.map((p: string) => (
              <div key={p} className="pending-item">
                <span>ID: {p}</span>
                <div className="pending-actions">
                  <button 
                    className="btn btn-primary btn-small"
                    onClick={() => respondFriend(p, true)}
                  >
                    承認
                  </button>
                  <button 
                    className="btn btn-secondary btn-small"
                    onClick={() => respondFriend(p, false)}
                  >
                    拒否
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function genCode(len = 8) { 
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; 
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); 
}