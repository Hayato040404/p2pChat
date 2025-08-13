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
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:'#f7fff8'}}>
      <div style={{width:'92%',maxWidth:720,background:'#fff',padding:20,borderRadius:12,boxShadow:'0 6px 30px rgba(0,0,0,0.08)'}}>
        <h1 style={{color:'#006b2f'}}>利用規約とデータ保存について</h1>
        <p>ようこそ。以下を必ずお読みください：</p>
        <ul>
          <li>メッセージ履歴はサーバーに <strong>最大3日間</strong> 保存されます。</li>
          <li>本サーバーのデータは <strong>インメモリ保存</strong> です。サーバー再起動・スケール等により、すべてのデータ（履歴・公開ルーム・フレンド関係など）が消える可能性があります。</li>
          <li>匿名で利用できますが、ブラウザに保存された「マイコード」や UUID は端末に残ります。</li>
        </ul>
        <div style={{marginTop:18,display:'flex',gap:8}}>
          <button onClick={()=>accept()} style={{background:'#00b050',color:'#fff',padding:'10px 14px',borderRadius:10,border:'none'}}>同意して開始</button>
        </div>
      </div>
    </div>
  );
}
