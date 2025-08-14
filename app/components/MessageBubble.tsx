export default function MessageBubble({ text, isSelf, isSystem }: any) {
  const formatMessage = (text: string) => {
    // Remove "you:" prefix for self messages
    if (isSelf && text.startsWith('you:')) {
      return text.substring(4).trim();
    }
    return text;
  };

  const getMessageType = () => {
    if (isSystem) return 'system';
    if (isSelf) return 'self';
    return 'other';
  };

  return (
    <div className={`message-container ${getMessageType()}`}>
      <div className={`bubble ${getMessageType()}`}>
        <div className="message-text">
          {formatMessage(text)}
        </div>
        {!isSystem && (
          <div className="timestamp">
            {new Date().toLocaleTimeString('ja-JP', { 
              hour: '2-digit', 
              minute: '2-digit' 
            })}
          </div>
        )}
      </div>
    </div>
  );
}