'use client';
import { useState, useEffect, useRef } from 'react';
import Pusher from 'pusher-js';
import { createClient } from '@supabase/supabase-js';

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

  const fetchRooms = async () => {
    const { data } = await supabase.from('rooms').select('*').order('created_at', { ascending: false });
    if (data) setRooms(data);
  };

  useEffect(() => {
    fetchRooms();
    const channel = supabase.channel('db-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => fetchRooms()).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const unlockAudio = async () => {
    if (!audioCtx.current) audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioCtx.current.state === 'suspended') await audioCtx.current.resume();
  };

  useEffect(() => {
    if (!joined || !room) return;
    if (!pusherRef.current) pusherRef.current = new Pusher("48da82b32a9dc96e8fbe", { cluster: "ap3" });
    const channel = pusherRef.current.subscribe(`team-${room}`);
    channel.bind('sync-event', (data: any) => {
      setConfig({ bpm: Number(data.bpm), isPlaying: data.isPlaying, startTime: data.startTime });
    });
    return () => { pusherRef.current?.unsubscribe(`team-${room}`); };
  }, [joined, room]);

  useEffect(() => {
    if (joined && config.isPlaying) startSyncedAudio(config);
    else stopAudio();
  }, [config.isPlaying, config.bpm, config.startTime, joined]);

  const startSyncedAudio = (c: any) => {
    stopAudio(); 
    if (!audioCtx.current) return;
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
    g.gain.linearRampToValueAtTime(0.2, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.start(t); osc.stop(t + 0.1);
  };

  const stopAudio = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setCurrentBeat(-1);
  };

  // 🛠️ [터치 먹통 해결] 인자를 더 명확하게 처리함
  const send = async (action: 'TOGGLE' | 'BPM', value?: number) => {
    await unlockAudio();
    
    let nextIsPlaying = config.isPlaying;
    let nextBpm = config.bpm;
    let nextStartTime = config.startTime;

    if (action === 'TOGGLE') {
      nextIsPlaying = !config.isPlaying;
      nextStartTime = nextIsPlaying ? Date.now() / 1000 : 0;
    } else if (action === 'BPM' && value) {
      nextBpm = value;
      // 재생 중일 때 속도를 바꿔도 기존 startTime을 유지해야 박자가 안 튐
      if (!nextIsPlaying) nextStartTime = 0;
    }

    const updated = { bpm: nextBpm, isPlaying: nextIsPlaying, startTime: nextStartTime };
    setConfig(updated);

    await supabase.from('rooms').update({ 
      bpm: updated.bpm, is_playing: updated.isPlaying, start_time: updated.startTime 
    }).eq('name', room);

    await fetch('/api/sync', { method: 'POST', body: JSON.stringify({ ...updated, teamId: room }) });
  };

  const joinRoom = async (selectedRoom: any) => {
    await unlockAudio();
    setRoom(selectedRoom.name);
    setJoined(true);
    setConfig({ bpm: selectedRoom.bpm, isPlaying: selectedRoom.is_playing, startTime: selectedRoom.start_time });
  };

  const deleteRoom = async (e: React.MouseEvent, roomName: string) => {
    e.stopPropagation();
    if (confirm(`'${roomName}' 팀을 삭제할까?`)) {
      await supabase.from('rooms').delete().eq('name', roomName);
      fetchRooms();
    }
  };

  if (!joined) {
    return (
      <main style={{ minHeight: '100dvh', backgroundColor: '#F1F3F5', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 24px' }}>
        <h1 style={{ fontSize: '11px', letterSpacing: '8px', color: '#ADB5BD', marginBottom: '60px' }}>SHARE METRONOME</h1>
        <div style={{ width: '100%', maxWidth: '360px' }}>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '40px', borderBottom: '1.5px solid #DEE2E6' }}>
            <input type="text" placeholder="TEAM NAME" onChange={e => setRoom(e.target.value)} style={{ flex: 1, background: 'transparent', border: 'none', padding: '10px', outline: 'none' }} />
            <button onClick={() => supabase.from('rooms').insert([{ name: room, bpm: 80, is_playing: false, start_time: 0 }]).then(fetchRooms)} style={{ background: '#212529', color: '#FFF', border: 'none', padding: '10px 20px', borderRadius: '4px' }}>CREATE</button>
          </div>
          {rooms.map(r => (
            <div key={r.id} onClick={() => joinRoom(r)} style={{ background: '#FFF', padding: '20px', borderRadius: '12px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #E9ECEF' }}>
              <span style={{ fontWeight: '700' }}>{r.name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <span style={{ color: r.is_playing ? '#40C057' : '#ADB5BD', fontSize: '12px', fontWeight: 'bold' }}>{r.is_playing ? '● ON' : 'OFF'}</span>
                <button onClick={(e) => deleteRoom(e, r.name)} style={{ background: 'none', border: 'none', color: '#FF6B6B', fontSize: '18px' }}>×</button>
              </div>
            </div>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100dvh', backgroundColor: '#F1F3F5', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <span onClick={() => { stopAudio(); setJoined(false); }} style={{ cursor: 'pointer', color: '#ADB5BD', fontWeight: 'bold', marginBottom: '20px' }}>← BACK TO LIST</span>
      <h2 style={{ fontSize: '30px', marginBottom: '30px', fontWeight: '800' }}>{room.toUpperCase()}</h2>
      <div style={{ display: 'flex', gap: '15px', marginBottom: '40px' }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{ width: '50px', height: '50px', borderRadius: '50%', background: currentBeat === i ? '#212529' : '#FFF', border: '2px solid #DEE2E6', transition: '0.05s' }} />
        ))}
      </div>
      <div style={{ fontSize: '100px', fontWeight: '100', marginBottom: '20px' }}>{config.bpm}</div>
      {/* 🛠️ 슬라이더 터치 제어 수정 */}
      <input type="range" min="40" max="240" value={config.bpm} onChange={e => send('BPM', Number(e.target.value))} style={{ width: '200px', accentColor: '#212529', marginBottom: '40px' }} />
      {/* 🛠️ 버튼 터치 제어 수정 */}
      <button onClick={() => send('TOGGLE')} style={{ width: '90px', height: '90px', borderRadius: '50%', background: config.isPlaying ? '#212529' : 'transparent', color: config.isPlaying ? 'white' : '#212529', border: '2px solid #212529', fontWeight: 'bold', cursor: 'pointer' }}>
        {config.isPlaying ? 'STOP' : 'PLAY'}
      </button>
    </main>
  );
}