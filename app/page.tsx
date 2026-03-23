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

  const fetchRooms = async () => {
    const { data } = await supabase.from('rooms').select('*').order('created_at', { ascending: false });
    if (data) setRooms(data);
  };

  useEffect(() => {
    fetchRooms();
    const channel = supabase.channel('rooms').on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => fetchRooms()).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // 지각생 합류 로직
  const joinRoom = async (selectedRoom: any) => {
    setRoom(selectedRoom.name);
    const newConfig = { bpm: selectedRoom.bpm, isPlaying: selectedRoom.is_playing, startTime: selectedRoom.start_time };
    setConfig(newConfig);
    setJoined(true);
    initAudio();
    if (newConfig.isPlaying) startSyncedAudio(newConfig);
  };

  useEffect(() => {
    if (!joined || !room) return;
    pusherRef.current = new Pusher("48da82b32a9dc96e8fbe", { cluster: "ap3" });
    const channel = pusherRef.current.subscribe(`team-${room}`);
    
    channel.bind('sync-event', (data: any) => {
      const newConfig = { bpm: Number(data.bpm), isPlaying: data.isPlaying, startTime: data.startTime };
      setConfig(newConfig);
      if (data.isPlaying) startSyncedAudio(newConfig); else stopAudio();
    });

    return () => { stopAudio(); pusherRef.current?.disconnect(); };
  }, [joined, room]);

  const initAudio = () => {
    if (!audioCtx.current) audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioCtx.current.state === 'suspended') audioCtx.current.resume();
  };

  const startSyncedAudio = (c: any) => {
    initAudio(); stopAudio();
    const secondsPerBeat = 60 / c.bpm;
    const serverNow = Date.now() / 1000;
    const elapsed = serverNow - c.startTime;
    const beatsElapsed = Math.floor(elapsed / secondsPerBeat);
    
    nextBeatTimeRef.current = audioCtx.current!.currentTime + (secondsPerBeat - (elapsed % secondsPerBeat));
    let beatCounter = (beatsElapsed + 1) % 4;

    const scheduler = () => {
      while (nextBeatTimeRef.current < audioCtx.current!.currentTime + 0.1) {
        const scheduleTime = nextBeatTimeRef.current;
        playTick(scheduleTime, beatCounter);
        const savedBeat = beatCounter;
        setTimeout(() => setCurrentBeat(savedBeat), (scheduleTime - audioCtx.current!.currentTime) * 1000);
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
    gain.gain.linearRampToValueAtTime(0.1, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    osc.start(time); osc.stop(time + 0.06);
  };

  const stopAudio = () => { if (timerRef.current) clearTimeout(timerRef.current); setCurrentBeat(-1); };

  const send = async (v: any) => {
    const startTime = v.isPlaying ? (Date.now() / 1000) : 0;
    const updated = { ...config, ...v, startTime };
    setConfig(updated);
    
    // 1. DB 상태 업데이트 (지각생을 위해 저장!)
    await supabase.from('rooms').update({ 
      bpm: updated.bpm, 
      is_playing: updated.isPlaying, 
      start_time: updated.startTime 
    }).eq('name', room);

    // 2. 현재 접속자들에게 Pusher 신호 전송
    fetch('/api/sync', { method: 'POST', body: JSON.stringify({ ...updated, teamId: room }) });
  };

  if (!joined) {
    return (
      <main style={{ minHeight: '100dvh', backgroundColor: '#F1F3F5', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 24px' }}>
        <h1 style={{ fontSize: '11px', letterSpacing: '8px', color: '#ADB5BD', marginBottom: '60px' }}>SHARE METRONOME</h1>
        <div style={{ width: '100%', maxWidth: '360px' }}>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '40px', borderBottom: '1.5px solid #DEE2E6' }}>
            <input type="text" placeholder="TEAM NAME" onChange={e => setRoom(e.target.value)} style={{ flex: 1, background: 'transparent', border: 'none', padding: '10px' }} />
            <button onClick={() => supabase.from('rooms').insert([{ name: room }]).then(fetchRooms)} style={{ background: '#212529', color: '#FFF', border: 'none', padding: '10px 20px', borderRadius: '4px' }}>CREATE</button>
          </div>
          {rooms.map(r => (
            <div key={r.id} onClick={() => joinRoom(r)} style={{ background: '#FFF', padding: '20px', borderRadius: '12px', marginBottom: '10px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', border: '1px solid #E9ECEF' }}>
              <span style={{ fontWeight: '700' }}>{r.name}</span>
              <span onClick={(e) => { e.stopPropagation(); supabase.from('rooms').delete().eq('id', r.id).then(fetchRooms); }} style={{ color: '#FF8787' }}>DEL</span>
            </div>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100dvh', backgroundColor: '#F1F3F5', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <span onClick={() => { stopAudio(); setJoined(false); }} style={{ cursor: 'pointer', color: '#ADB5BD', fontWeight: 'bold' }}>← BACK TO LIST</span>
      <h2 style={{ fontSize: '30px', margin: '30px 0', fontWeight: '800' }}>{room.toUpperCase()}</h2>
      <div style={{ display: 'flex', gap: '15px', marginBottom: '40px' }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{ width: '50px', height: '50px', borderRadius: '50%', background: currentBeat === i ? '#212529' : '#FFF', border: '2px solid #DEE2E6', transition: '0.05s' }} />
        ))}
      </div>
      <div style={{ fontSize: '100px', fontWeight: '100', marginBottom: '20px' }}>{config.bpm}</div>
      <input type="range" min="40" max="240" value={config.bpm} onChange={e => send({ bpm: Number(e.target.value), isPlaying: config.isPlaying })} style={{ width: '80%', maxWidth: '300px', accentColor: '#212529', marginBottom: '40px' }} />
      <button onClick={() => send({ isPlaying: !config.isPlaying })} style={{ width: '90px', height: '90px', borderRadius: '50%', background: config.isPlaying ? '#212529' : 'transparent', color: config.isPlaying ? 'white' : '#212529', border: '2px solid #212529', fontWeight: 'bold' }}>
        {config.isPlaying ? 'STOP' : 'PLAY'}
      </button>
    </main>
  );
}