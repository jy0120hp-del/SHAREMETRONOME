'use client';
import { useState, useEffect, useRef } from 'react';
import Pusher from 'pusher-js';
import { createClient } from '@supabase/supabase-js';

// 🛠️ Supabase 키 직접 삽입 (Vercel 빌드 에러 방지용)
const supabase = createClient(
  'https://tbypnzqvntghyatakdzc.supabase.co', 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRieXBuenF2bnRnaHlhdGFrZHpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzk2NTQsImV4cCI6MjA4OTg1NTY1NH0._eByvyWTFXf_1_bEIhz3a207GrKhCoafMJGTwUD6yL8'
);

export default function MetronomePage() {
  const [rooms, setRooms] = useState<any[]>([]);
  const [room, setRoom] = useState('');
  const [joined, setJoined] = useState(false);
  const [config, setConfig] = useState({ bpm: 80, isPlaying: false, startTime: 0 });
  const [currentBeat, setCurrentBeat] = useState(-1);

  const audioCtx = useRef<AudioContext | null>(null);
  const nextBeatTimeRef = useRef(0);
  const timerRef = useRef<any>(null);
  const pusherRef = useRef<Pusher | null>(null);

  // 1. DB에서 목록 실시간 연동
  const fetchRooms = async () => {
    const { data } = await supabase.from('rooms').select('*').order('created_at', { ascending: false });
    if (data) setRooms(data);
  };

  useEffect(() => {
    fetchRooms();
    const channel = supabase.channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => fetchRooms())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // 2. 오디오 엔진 깨우기 (모바일 필수)
  const initAudio = () => {
    if (!audioCtx.current) {
      audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtx.current.state === 'suspended') {
      audioCtx.current.resume();
    }
  };

  // 3. 방 입장 및 강제 동기화
  const joinRoom = async (selectedRoom: any) => {
    initAudio();
    setRoom(selectedRoom.name);
    setJoined(true);
    
    // 입장 시 최신 DB 상태로 박자 계산 시작
    const syncConfig = { 
      bpm: selectedRoom.bpm || 80, 
      isPlaying: selectedRoom.is_playing || false, 
      startTime: selectedRoom.start_time || 0 
    };
    setConfig(syncConfig);
    if (syncConfig.isPlaying) startSyncedAudio(syncConfig);
  };

  useEffect(() => {
    if (!joined || !room) return;
    if (!pusherRef.current) {
      pusherRef.current = new Pusher("48da82b32a9dc96e8fbe", { cluster: "ap3" });
    }
    const channel = pusherRef.current.subscribe(`team-${room}`);
    
    channel.bind('sync-event', (data: any) => {
      const newConfig = { bpm: Number(data.bpm), isPlaying: data.isPlaying, startTime: data.startTime };
      setConfig(newConfig);
      if (data.isPlaying) startSyncedAudio(newConfig); else stopAudio();
    });

    return () => { stopAudio(); pusherRef.current?.unsubscribe(`team-${room}`); };
  }, [joined, room]);

  // 4. 서버 시간 기반 박자 스케줄러
  const startSyncedAudio = (c: any) => {
    initAudio(); stopAudio();
    const secondsPerBeat = 60 / c.bpm;
    
    const scheduler = () => {
      const serverNow = Date.now() / 1000;
      const elapsed = serverNow - c.startTime;
      const beatsElapsed = Math.floor(elapsed / secondsPerBeat);
      const timeUntilNextBeat = ((beatsElapsed + 1) * secondsPerBeat) - elapsed;
      
      nextBeatTimeRef.current = audioCtx.current!.currentTime + timeUntilNextBeat;
      let beatCounter = (beatsElapsed + 1) % 4;

      const run = () => {
        while (nextBeatTimeRef.current < audioCtx.current!.currentTime + 0.1) {
          playTick(nextBeatTimeRef.current, beatCounter);
          const b = beatCounter;
          setTimeout(() => setCurrentBeat(b), Math.max(0, (nextBeatTimeRef.current - audioCtx.current!.currentTime) * 1000));
          nextBeatTimeRef.current += secondsPerBeat;
          beatCounter = (beatCounter + 1) % 4;
        }
        timerRef.current = setTimeout(run, 25);
      };
      run();
    };
    scheduler();
  };

  const playTick = (t: number, b: number) => {
    const osc = audioCtx.current!.createOscillator();
    const g = audioCtx.current!.createGain();
    osc.connect(g); g.connect(audioCtx.current!.destination);
    osc.frequency.setValueAtTime(b === 0 ? 880 : 440, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.1, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.start(t); osc.stop(t + 0.06);
  };

  const stopAudio = () => { if (timerRef.current) clearTimeout(timerRef.current); setCurrentBeat(-1); };

  // 5. 상태 변경 및 DB/Pusher 전송
  const send = async (v: any) => {
    initAudio();
    const startTime = v.isPlaying ? (Date.now() / 1000) : 0;
    const updated = { ...config, ...v, startTime };
    setConfig(updated);

    await supabase.from('rooms').update({ 
      bpm: updated.bpm, is_playing: updated.isPlaying, start_time: updated.startTime 
    }).eq('name', room);

    await fetch('/api/sync', { method: 'POST', body: JSON.stringify({ ...updated, teamId: room }) });
  };

  const createRoom = async () => {
    if (!room) return;
    await supabase.from('rooms').insert([{ name: room, bpm: 80, is_playing: false, start_time: 0 }]);
    fetchRooms();
  };

  if (!joined) {
    return (
      <main style={{ minHeight: '100dvh', backgroundColor: '#F1F3F5', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 24px' }}>
        <h1 style={{ fontSize: '12px', letterSpacing: '5px', color: '#ADB5BD', marginBottom: '40px', fontWeight: 'bold' }}>SHARE METRONOME</h1>
        <div style={{ width: '100%', maxWidth: '360px' }}>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '30px' }}>
            <input type="text" placeholder="TEAM NAME" onChange={e => setRoom(e.target.value)} style={{ flex: 1, padding: '15px', borderRadius: '12px', border: '1px solid #DEE2E6' }} />
            <button onClick={createRoom} style={{ background: '#212529', color: 'white', border: 'none', padding: '0 20px', borderRadius: '12px', fontWeight: 'bold' }}>ADD</button>
          </div>
          {rooms.map(r => (
            <div key={r.id} onClick={() => joinRoom(r)} style={{ background: 'white', padding: '25px', borderRadius: '16px', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', border: '1px solid #E9ECEF' }}>
              <span style={{ fontSize: '18px', fontWeight: '800' }}>{r.name}</span>
              <span style={{ fontSize: '12px', fontWeight: 'bold', color: r.is_playing ? '#40C057' : '#ADB5BD' }}>{r.is_playing ? '● ON' : 'OFF'}</span>
            </div>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100dvh', backgroundColor: '#F1F3F5', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <button onClick={() => { stopAudio(); setJoined(false); }} style={{ position: 'absolute', top: '30px', left: '20px', background: 'none', border: 'none', color: '#ADB5BD', fontWeight: 'bold' }}>← LIST</button>
      <h2 style={{ fontSize: '28px', fontWeight: '900', marginBottom: '40px' }}>{room.toUpperCase()}</h2>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '60px' }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{ width: '55px', height: '55px', borderRadius: '50%', background: currentBeat === i ? '#212529' : 'white', border: '2px solid #DEE2E6' }} />
        ))}
      </div>
      <div style={{ fontSize: '100px', fontWeight: '200', marginBottom: '10px' }}>{config.bpm}</div>
      <input type="range" min="40" max="240" value={config.bpm} onChange={e => send({ bpm: Number(e.target.value), isPlaying: config.isPlaying })} style={{ width: '80%', maxWidth: '300px', marginBottom: '60px' }} />
      <button onClick={() => send({ isPlaying: !config.isPlaying })} style={{ width: '110px', height: '110px', borderRadius: '50%', background: config.isPlaying ? '#212529' : 'white', color: config.isPlaying ? 'white' : '#212529', border: '4px solid #212529', fontSize: '22px', fontWeight: '900' }}>
        {config.isPlaying ? 'STOP' : 'PLAY'}
      </button>
    </main>
  );
}