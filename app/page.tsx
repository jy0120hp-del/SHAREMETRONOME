'use client';
import { useState, useEffect, useRef } from 'react';
import Pusher from 'pusher-js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
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

  // DB에서 목록 가져오기
  const fetchRooms = async () => {
    const { data } = await supabase.from('rooms').select('*').order('created_at', { ascending: false });
    if (data) setRooms(data);
  };

  useEffect(() => {
    fetchRooms();
    // 실시간 구독: 누군가 PLAY 누르면 목록의 ON/OFF도 즉시 바뀜
    const channel = supabase.channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => {
        fetchRooms();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const initAudio = () => {
    if (!audioCtx.current) audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioCtx.current.state === 'suspended') audioCtx.current.resume();
  };

  const joinRoom = async (selectedRoom: any) => {
    initAudio();
    setRoom(selectedRoom.name);
    setJoined(true);
    
    // 들어가는 순간의 최신 상태 적용
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
    if (!pusherRef.current) pusherRef.current = new Pusher("48da82b32a9dc96e8fbe", { cluster: "ap3" });
    const channel = pusherRef.current.subscribe(`team-${room}`);
    
    channel.bind('sync-event', (data: any) => {
      const newConfig = { bpm: Number(data.bpm), isPlaying: data.isPlaying, startTime: data.startTime };
      setConfig(newConfig);
      if (data.isPlaying) startSyncedAudio(newConfig); else stopAudio();
    });

    return () => { stopAudio(); pusherRef.current?.unsubscribe(`team-${room}`); };
  }, [joined, room]);

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

  const send = async (v: any) => {
    initAudio();
    const startTime = v.isPlaying ? (Date.now() / 1000) : 0;
    const updated = { ...config, ...v, startTime };
    setConfig(updated);

    // DB 업데이트 (목록의 ON/OFF를 결정함!)
    await supabase.from('rooms').update({ 
      bpm: updated.bpm, is_playing: updated.isPlaying, start_time: updated.startTime 
    }).eq('name', room);

    await fetch('/api/sync', { method: 'POST', body: JSON.stringify({ ...updated, teamId: room }) });
  };

  // 방 새로 만들기 (기본값 확실히 넣기)
  const createRoom = async () => {
    if (!room) return;
    await supabase.from('rooms').insert([{ 
      name: room, bpm: 80, is_playing: false, start_time: 0 
    }]);
    fetchRooms();
  };

  if (!joined) {
    return (
      <main style={{ minHeight: '100dvh', backgroundColor: '#F1F3F5', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 24px' }}>
        <h1 style={{ fontSize: '12px', letterSpacing: '5px', color: '#ADB5BD', marginBottom: '40px', fontWeight: 'bold' }}>SHARE METRONOME</h1>
        <div style={{ width: '100%', maxWidth: '360px' }}>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '30px' }}>
            <input type="text" placeholder="TEAM NAME" onChange={e => setRoom(e.target.value)} style={{ flex: 1, padding: '15px', borderRadius: '12px', border: '1px solid #DEE2E6', outline: 'none' }} />
            <button onClick={createRoom} style={{ background: '#212529', color: 'white', border: 'none', padding: '0 20px', borderRadius: '12px', fontWeight: 'bold' }}>ADD</button>
          </div>
          {rooms.map(r => (
            <div key={r.id} onClick={() => joinRoom(r)} style={{ background: 'white', padding: '25px', borderRadius: '16px', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', border: '1px solid #E9ECEF' }}>
              <span style={{ fontSize: '18px', fontWeight: '800' }}>{r.name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 'bold', color: r.is_playing ? '#40C057' : '#ADB5BD' }}>
                  {r.is_playing ? '● ON' : 'OFF'}
                </span>
                <span onClick={(e) => { e.stopPropagation(); supabase.from('rooms').delete().eq('id', r.id).then(fetchRooms); }} style={{ color: '#FF8787', fontSize: '12px', marginLeft: '10px' }}>DEL</span>
              </div>
            </div>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100dvh', backgroundColor: '#F1F3F5', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <button onClick={() => { stopAudio(); setJoined(false); }} style={{ position: 'absolute', top: '30px', left: '20px', background: 'none', border: 'none', color: '#ADB5BD', fontWeight: 'bold', fontSize: '16px' }}>← LIST</button>
      <h2 style={{ fontSize: '28px', fontWeight: '900', marginBottom: '40px', letterSpacing: '-1px' }}>{room.toUpperCase()}</h2>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '60px' }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{ width: '55px', height: '55px', borderRadius: '50%', background: currentBeat === i ? '#212529' : 'white', border: '2px solid #DEE2E6', transition: '0.1s' }} />
        ))}
      </div>
      <div style={{ fontSize: '100px', fontWeight: '200', marginBottom: '10px', color: '#212529' }}>{config.bpm}</div>
      <input type="range" min="40" max="240" value={config.bpm} onChange={e => send({ bpm: Number(e.target.value), isPlaying: config.isPlaying })} style={{ width: '80%', maxWidth: '300px', accentColor: '#212529', marginBottom: '60px' }} />
      <button onClick={() => send({ isPlaying: !config.isPlaying })} style={{ width: '110px', height: '110px', borderRadius: '50%', background: config.isPlaying ? '#212529' : 'white', color: config.isPlaying ? 'white' : '#212529', border: '4px solid #212529', fontSize: '22px', fontWeight: '900', cursor: 'pointer', boxShadow: '0 10px 20px rgba(0,0,0,0.1)' }}>
        {config.isPlaying ? 'STOP' : 'PLAY'}
      </button>
    </main>
  );
}