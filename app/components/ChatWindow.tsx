'use client';
import React, { useEffect, useRef, useState } from 'react';
import MessageBubble from './MessageBubble';

export default function ChatWindow({ 
  roomId, members, onSend, log, createRoom, promote, kick, mute, openDM, myId 
}: any) {
  const [input, setInput] = useState('');
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [log]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  };

  const handleSend = () => {
    if (input.trim() && roomId) {
      onSend(input.trim());
      setInput('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // determine my role in this room
  const myRole = (members || []).find((m: any) => m.uid === myId)?.role || 'user';

  const getInitials = (name: string) => {
    return name ? name.charAt(0).toUpperCase() : '?';
  };

  if (!roomId) {
    return (
      <div className="chat-wrap">
        <div className="empty-state">
          <div className="empty-icon">💬</div>
          <div className="empty-title">チャットを選択してください</div>
          <div className="empty-description">
            左側のリストからチャットルームを選択するか、<br />
            新しいルームを作成してください。
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-wrap">
      <div className="chat-header">
        <div className="chat-title">
          {roomId.startsWith('DM-') ? 'ダイレクトメッセージ' : roomId}
        </div>
        {members && members.length > 0 && (
          <div className="chat-members">
            {members.map((m: any) => (
              <div key={m.uid} className="member-chip">
                <div className="chat-avatar" style={{ width: '24px', height: '24px', fontSize: '12px' }}>
                  {getInitials(m.nickname || m.uid)}
                </div>
                <span>
                  {m.nickname || m.uid.slice(0, 6)}
                  {m.role === 'admin' ? ' 👑' : m.role === 'mod' ? ' 🛡️' : ''}
                </span>
                {myRole === 'admin' && m.uid !== myId && (
                  <div className="member-actions">
                    <button 
                      className="member-action"
                      onClick={() => promote(roomId, m.uid, 'mod')}
                    >
                      MOD
                    </button>
                    <button 
                      className="member-action"
                      onClick={() => promote(roomId, m.uid, 'user')}
                    >
                      USER
                    </button>
                    <button 
                      className="member-action"
                      onClick={() => kick(roomId, m.uid)}
                      style={{ background: '#ff3b30' }}
                    >
                      KICK
                    </button>
                    <button 
                      className="member-action"
                      onClick={() => mute(roomId, m.uid)}
                      style={{ background: '#ff9500' }}
                    >
                      MUTE
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="chat-body" ref={bodyRef}>
        {log.slice().reverse().map((l: string, i: number) => (
          <MessageBubble 
            key={i} 
            text={l} 
            isSelf={l.startsWith('you:')}
            isSystem={l.startsWith('🟢') || l.startsWith('🔴') || l.startsWith('⚠️') || l.startsWith('❌') || l.startsWith('ℹ️')}
          />
        ))}
      </div>

      <div className="chat-footer">
        <textarea
          ref={textareaRef}
          className="message-input"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={roomId ? 'メッセージを入力...' : 'ルームを選択してください'}
          disabled={!roomId}
          rows={1}
        />
        <button 
          className="send-btn" 
          onClick={handleSend} 
          disabled={!roomId || !input.trim()}
        >
          ➤
        </button>
      </div>
    </div>
  );
}