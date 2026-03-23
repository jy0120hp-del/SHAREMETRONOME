'use client';
import { useState, useEffect, useRef } from 'react';
import Pusher from 'pusher-js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function MetronomePage() {
  const [rooms, setRooms] = useState<string[]>([]);
  const [room, setRoom] = useState('');
  const [joined, setJoined] = useState(false);
  const [config, setConfig] = useState({ bpm: 80, isPlaying: false, startTime: 0 });
  const [currentBeat, setCurrentBeat] = useState(-1);

  const audioCtx = useRef<AudioContext | null>(null);
  const nextBeatTimeRef = useRef(0);
  const timerRef = useRef<any>(null);
  const pusherRef = useRef<Pusher | null>(null);

  const fetchRooms = async () => {
    const { data } = await supabase.from('rooms').select('name').order('created_at', { ascending: false });
    if (data) setRooms(data.map(r => r.name));
  };

  useEffect(() => {
    fetchRooms();
    const channel = supabase.channel('rooms').on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => fetchRooms()).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (!joined || !room) return;
    pusherRef.current = new Pusher("48da82b32a9dc96e8fbe", { cluster: "ap3" });
    const channel = pusherRef.current.subscribe(`team-${room}`);
    
    channel.bind('sync-event', (data: any) => {
      const newConfig = { bpm: Number(data.bpm), isPlaying: data.isPlaying, startTime: data.startTime };
      setConfig(newConfig);
      if (data.isPlaying) startSyncedAudio(newConfig);
      else stopAudio();
    });

    return () => { stopAudio(); pusherRef.current?.disconnect(); };
  }, [joined, room]);

  const initAudio = () => {
    if (!audioCtx.current) audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioCtx.current.state === 'suspended') audioCtx.current.resume();
  };

  const startSyncedAudio = (c: any) => {
    initAudio();
    stopAudio();
    
    const secondsPerBeat = 60 / c.bpm;
    const now = audioCtx.current!.currentTime;
    // 서버 시작 시간과 현재 오디오 시간의 차이를 계산해서 '지금 몇 번째 박자여야 하는지' 찾아냄
    const serverNow = Date.now() / 1000;
    const elapsed = serverNow - c.startTime;
    const beatsElapsed = Math.floor(elapsed / secondsPerBeat);
    
    // 다음 박자가 올 정확한 타이밍 계산
    nextBeatTimeRef.current = now + (secondsPerBeat - (elapsed % secondsPerBeat));
    let beatCounter = (beatsElapsed + 1) % 4;

    const scheduler = () => {
      while (nextBeatTimeRef.current < audioCtx.current!.currentTime + 0.1) {
        const scheduleTime = nextBeatTimeRef.current;
        playTick(scheduleTime, beatCounter);
        
        const currentRef = beatCounter;
        setTimeout(() => setCurrentBeat(currentRef), (scheduleTime - audioCtx.current!.currentTime) * 1000);
        
        nextBeatTimeRef.current += secondsPerBeat;
        beatCounter = (beatCounter + 1) % 4;
      }
      timerRef.current = setTimeout(scheduler, 25);
    };
    scheduler();
  };

  const playTick = (time: number, beat: number) => {
    const osc = audioCtx.current!.createOscillator();
    const gain = audioCtx.current!.createGain();
    osc.connect(gain); gain.connect(audioCtx.current!.destination);
    osc.frequency.setValueAtTime(beat === 0 ? 880 : 440, time);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.2, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
    osc.start(time); osc.stop(time + 0.1);
  };

  const stopAudio = () => { if (timerRef.current) clearTimeout(timerRef.current); setCurrentBeat(-1); };

  const send = (v: any) => {
    const startTime = v.isPlaying ? (Date.now() / 1000) : 0;
    const payload = { ...config, ...v, startTime, teamId: room };
    fetch('/api/sync', { method: 'POST', body: JSON.stringify(payload) });
  };

  if (!joined) {
    return (
      <main style={{ minHeight: '100dvh', backgroundColor: '#F1F3F5', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 24px' }}>
        <h1 style={{ fontSize: '11px', letterSpacing: '8px', color: '#ADB5BD', marginBottom: '60px' }}>BAND SYNC PRO</h1>
        <div style={{ width: '100%', maxWidth: '360px' }}>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '40px', borderBottom: '1.5px solid #DEE2E6' }}>
            <input type="text" placeholder="TEAM NAME" onChange={e => setRoom(e.target.value)} style={{ flex: 1, background: 'transparent', border: 'none', padding: '10px' }} />
            <button onClick={() => { supabase.from('rooms').insert([{ name: room }]).then(() => { initAudio(); setJoined(true); }) }} style={{ background: '#212529', color: '#FFF', border: 'none', padding: '10px 20px', borderRadius: '4px' }}>CREATE</button>
          </div>
          {rooms.map(r => (
            <div key={r} onClick={() => { setRoom(r); initAudio(); setJoined(true); }} style={{ background: '#FFF', padding: '20px', borderRadius: '12px', marginBottom: '10px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: '700' }}>{r}</span>
              <span onClick={(e) => { e.stopPropagation(); supabase.from('rooms').delete().eq('name', r).then(() => fetchRooms()); }} style={{ color: '#FF8787' }}>DEL</span>
            </div>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100dvh', backgroundColor: '#F1F3F5', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <span onClick={() => { stopAudio(); setJoined(false); }} style={{ cursor: 'pointer', color: '#ADB5BD' }}>← BACK</span>
      <h2 style={{ fontSize: '30px', margin: '20px 0' }}>{room.toUpperCase()}</h2>
      <div style={{ display: 'flex', gap: '15px', marginBottom: '40px' }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{ width: '50px', height: '50px', borderRadius: '50%', background: currentBeat === i ? '#212529' : '#FFF', border: '2px solid #DEE2E6' }} />
        ))}
      </div>
      <div style={{ fontSize: '80px', fontWeight: '100' }}>{config.bpm}</div>
      <input type="range" min="40" max="240" value={config.bpm} onChange={e => send({ bpm: Number(e.target.value), isPlaying: config.isPlaying })} style={{ width: '200px', margin: '30px 0' }} />
      <button onClick={() => send({ isPlaying: !config.isPlaying })} style={{ width: '80px', height: '80px', borderRadius: '50%', background: config.isPlaying ? '#212529' : 'white', color: config.isPlaying ? 'white' : 'black' }}>
        {config.isPlaying ? 'STOP' : 'PLAY'}
      </button>
    </main>
  );
}