export default function MessageBubble({ text, isSelf }: any){
  return (
    <div className={`bubble ${isSelf? 'self':'other'}`}>
      <div style={{whiteSpace:'pre-wrap'}}>{text}</div>
      <div className="timestamp">{new Date().toLocaleTimeString()}</div>
    </div>
  );
}
