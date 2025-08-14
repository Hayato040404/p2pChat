'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function ConsentPage(){
  const router = useRouter();

  useEffect(() => {
    // すでに同意済みなら戻す
    if (typeof window !== 'undefined') {
      const c = localStorage.getItem('p2pchat_consent');
      if (c) router.push('/');
    }
  }, [router]);

  function accept(){
    localStorage.setItem('p2pchat_consent','1');
    router.push('/');
  }

  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:'#f8f9fa'}}>
      <div style={{width:'92%',maxWidth:720,background:'#fff',padding:32,borderRadius:16,boxShadow:'0 8px 40px rgba(0,0,0,0.12)'}}>
        <div style={{textAlign:'center',marginBottom:24}}>
          <div style={{fontSize:48,marginBottom:16}}>💬</div>
          <h1 style={{color:'#06c755',fontSize:28,fontWeight:700,margin:0}}>p2pChat</h1>
        </div>
        <h2 style={{color:'#1d1d1f',fontSize:20,marginBottom:16}}>利用規約とデータ保存について</h2>
        <p>ようこそ。以下を必ずお読みください：</p>
        <ul style={{lineHeight:1.6,marginBottom:24}}>
          <li>メッセージ履歴はサーバーに <strong>最大3日間</strong> 保存されます。</li>
          <li>本サーバーのデータは <strong>インメモリ保存</strong> です。サーバー再起動・スケール等により、すべてのデータ（履歴・公開ルーム・フレンド関係など）が消える可能性があります。</li>
          <li>匿名で利用できますが、ブラウザに保存された「マイコード」や UUID は端末に残ります。</li>
        </ul>
        <div style={{marginTop:32,textAlign:'center'}}>
          <button 
            onClick={()=>accept()} 
            style={{
              background:'#06c755',
              color:'#fff',
              padding:'14px 32px',
              borderRadius:24,
              border:'none',
              fontSize:16,
              fontWeight:600,
              cursor:'pointer',
              boxShadow:'0 4px 16px rgba(6,199,85,0.3)'
            }}
          >
            同意して開始
          </button>
        </div>
      </div>
    </div>
  );
}
