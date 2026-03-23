'use client';
import { useState, useEffect, useRef } from 'react';
import Pusher from 'pusher-js';

export default function MetronomePage() {
  const [rooms, setRooms] = useState<string[]>([]);
  const [room, setRoom] = useState('');
  const [joined, setJoined] = useState(false);
  const [config, setConfig] = useState({ bpm: 80, isPlaying: false });
  const [currentBeat, setCurrentBeat] = useState(-1);

  const audioCtx = useRef<AudioContext | null>(null);
  const timerRef = useRef<any>(null);
  const pusherRef = useRef<Pusher | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('band-sync-rooms');
    if (saved) setRooms(JSON.parse(saved));
  }, []);

  useEffect(() => {
    if (!joined || !room) return;
    pusherRef.current = new Pusher("48da82b32a9dc96e8fbe", { cluster: "ap3" });
    const channel = pusherRef.current.subscribe(`team-${room}`);
    channel.bind('sync-event', (data: any) => {
      const newBpm = Number(data.bpm);
      setConfig({ bpm: newBpm, isPlaying: data.isPlaying });
      if (data.isPlaying) startAudio(newBpm);
      else stopAudio();
    });
    return () => { stopAudio(); pusherRef.current?.disconnect(); };
  }, [joined, room]);

  const initAudio = () => {
    if (!audioCtx.current) audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioCtx.current.state === 'suspended') audioCtx.current.resume();
  };

  const startAudio = (bpm: number) => {
    initAudio();
    stopAudio();
    let beat = 0;
    let nextTime = audioCtx.current!.currentTime + 0.05;
    const scheduler = () => {
      while (nextTime < audioCtx.current!.currentTime + 0.1) {
        playTick(nextTime, beat);
        const savedBeat = beat;
        setTimeout(() => setCurrentBeat(savedBeat), (nextTime - audioCtx.current!.currentTime) * 1000);
        nextTime += 60 / bpm;
        beat = (beat + 1) % 4;
      }
      timerRef.current = setTimeout(scheduler, 25);
    };
    scheduler();
  };

  const playTick = (time: number, beat: number) => {
    const osc = audioCtx.current!.createOscillator();
    const gain = audioCtx.current!.createGain();
    osc.connect(gain); gain.connect(audioCtx.current!.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(beat === 0 ? 800 : 500, time);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.12, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    osc.start(time); osc.stop(time + 0.06);
  };

  const stopAudio = () => { if (timerRef.current) clearTimeout(timerRef.current); setCurrentBeat(-1); };

  const handleAction = (type: 'add' | 'edit' | 'del', target?: string) => {
    let next = [...rooms];
    if (type === 'add' && room && !rooms.includes(room)) {
      next.push(room); initAudio(); setJoined(true);
    }
    if (type === 'del' && target) next = next.filter(r => r !== target);
    if (type === 'edit' && target) {
      const n = prompt("새로운 팀 이름:", target);
      if (n) next = next.map(r => r === target ? n : r);
    }
    setRooms(next);
    localStorage.setItem('band-sync-rooms', JSON.stringify(next));
  };

  const send = (v: any) => {
    const updated = { ...config, ...v };
    setConfig(updated);
    if (updated.isPlaying) startAudio(updated.bpm); else stopAudio();
    fetch('/api/sync', { method: 'POST', body: JSON.stringify({ ...updated, teamId: room }) });
  };

  if (!joined) {
    return (
      <main style={{ minHeight: '100dvh', backgroundColor: '#F1F3F5', color: '#212529', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px', fontFamily: '-apple-system, sans-serif' }}>
        <h1 style={{ fontSize: '11px', letterSpacing: '8px', color: '#ADB5BD', marginBottom: '60px', fontWeight: '800' }}>BAND SYNC PRO</h1>
        <div style={{ width: '100%', maxWidth: '360px' }}>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '40px', borderBottom: '1.5px solid #DEE2E6', paddingBottom: '8px' }}>
            <input 
              type="text" placeholder="TEAM NAME" 
              onChange={e => setRoom(e.target.value)}
              style={{ flex: 1, background: 'transparent', border: 'none', color: '#212529', fontSize: '16px', outline: 'none', fontWeight: '600' }}
            />
            <button onClick={() => handleAction('add')} style={{ background: '#212529', color: '#FFF', border: 'none', padding: '6px 14px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer' }}>CREATE</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {rooms.map(r => (
              <div key={r} onClick={() => { setRoom(r); initAudio(); setJoined(true); }} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#FFF', padding: '18px 20px', borderRadius: '12px', cursor: 'pointer', border: '1px solid #E9ECEF' }}>
                <span style={{ fontSize: '15px', fontWeight: '700' }}>{r}</span>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <span onClick={(e) => { e.stopPropagation(); handleAction('edit', r); }} style={{ color: '#ADB5BD', fontSize: '10px', fontWeight: '700' }}>EDIT</span>
                  <span onClick={(e) => { e.stopPropagation(); handleAction('del', r); }} style={{ color: '#FF8787', fontSize: '10px', fontWeight: '700' }}>DEL</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100dvh', backgroundColor: '#F1F3F5', color: '#212529', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', fontFamily: '-apple-system, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: '400px', textAlign: 'center' }}>
        <span onClick={() => { stopAudio(); setJoined(false); }} style={{ color: '#ADB5BD', fontSize: '11px', cursor: 'pointer', letterSpacing: '2px', fontWeight: '700' }}>← BACK TO LIST</span>
        
        <h2 style={{ fontSize: '28px', margin: '30px 0', color: '#212529', letterSpacing: '1px', fontWeight: '800' }}>{room.toUpperCase()}</h2>
        
        <div style={{ display: 'flex', justifyContent: 'center', gap: '15px', marginBottom: '50px' }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ 
              width: '50px', 
              height: '50px', 
              borderRadius: '50%', 
              background: currentBeat === i ? '#212529' : '#FFF', 
              border: '2px solid #DEE2E6',
              transition: '0.05s' 
            }} />
          ))}
        </div>

        <div style={{ fontSize: '100px', fontWeight: '100', marginBottom: '0px', color: '#212529', letterSpacing: '-3px' }}>{config.bpm}</div>

        <input 
          type="range" min="40" max="240" value={config.bpm}
          onChange={e => send({ bpm: Number(e.target.value), isPlaying: config.isPlaying })}
          style={{ width: '80%', appearance: 'none', background: '#DEE2E6', height: '3px', borderRadius: '4px', outline: 'none', margin: '40px 0', accentColor: '#212529', cursor: 'pointer' }}
        />

        <div style={{ marginTop: '20px' }}>
          <button 
            onClick={() => send({ isPlaying: !config.isPlaying })}
            style={{ 
              background: config.isPlaying ? '#212529' : 'transparent', 
              border: '2px solid #212529', 
              color: config.isPlaying ? '#FFF' : '#212529', 
              width: '90px', height: '90px', borderRadius: '50%', 
              fontSize: '15px', fontWeight: 'bold', cursor: 'pointer', transition: '0.2s' 
            }}
          >
            {config.isPlaying ? 'STOP' : 'PLAY'}
          </button>
        </div>
      </div>
    </main>
  );
}