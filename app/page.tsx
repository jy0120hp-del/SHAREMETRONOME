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
    const channel = supabase.channel('rooms-db').on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => fetchRooms()).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // 1. 오디오 엔진을 깨우는 함수 (폰에서 매우 중요!)
  const initAudio = () => {
    if (!audioCtx.current) {
      audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtx.current.state === 'suspended') {
      audioCtx.current.resume();
    }
  };

  // 2. 방에 들어갈 때 (지각생 합류 핵심)
  const joinRoom = async (selectedRoom: any) => {
    initAudio(); // 버튼 누르는 순간 소리 엔진 깨우기
    setRoom(selectedRoom.name);
    setJoined(true);
    
    // DB에서 최신 상태 다시 긁어오기
    const { data } = await supabase.from('rooms').select('*').eq('id', selectedRoom.id).single();
    if (data && data.is_playing) {
      const syncConfig = { bpm: data.bpm, isPlaying: true, startTime: data.start_time };
      setConfig(syncConfig);
      startSyncedAudio(syncConfig);
    }
  };

  useEffect(() => {
    if (!joined || !room) return;
    
    // Pusher 설정
    if (!pusherRef.current) {
      pusherRef.current = new Pusher("48da82b32a9dc96e8fbe", { cluster: "ap3" });
    }
    const channel = pusherRef.current.subscribe(`team-${room}`);
    
    channel.bind('sync-event', (data: any) => {
      const newConfig = { bpm: Number(data.bpm), isPlaying: data.isPlaying, startTime: data.startTime };
      setConfig(newConfig);
      if (data.isPlaying) startSyncedAudio(newConfig);
      else stopAudio();
    });

    return () => {
      stopAudio();
      if (pusherRef.current) {
        pusherRef.current.unsubscribe(`team-${room}`);
      }
    };
  }, [joined, room]);

  const startSyncedAudio = (c: any) => {
    if (!audioCtx.current) initAudio();
    stopAudio();

    const secondsPerBeat = 60 / c.bpm;
    
    const scheduler = () => {
      const serverNow = Date.now() / 1000;
      const elapsed = serverNow - c.startTime;
      const beatsElapsed = Math.floor(elapsed / secondsPerBeat);
      
      // 다음 비트가 올 시간 (서버 시간 기준)을 오디오 시간으로 변환
      const nextBeatInSeconds = (beatsElapsed + 1) * secondsPerBeat;
      const timeUntilNextBeat = nextBeatInSeconds - elapsed;
      
      nextBeatTimeRef.current = audioCtx.current!.currentTime + timeUntilNextBeat;
      let beatCounter = (beatsElapsed + 1) % 4;

      const run = () => {
        while (nextBeatTimeRef.current < audioCtx.current!.currentTime + 0.1) {
          const scheduleTime = nextBeatTimeRef.current;
          playTick(scheduleTime, beatCounter);
          const savedBeat = beatCounter;
          setTimeout(() => setCurrentBeat(savedBeat), Math.max(0, (scheduleTime - audioCtx.current!.currentTime) * 1000));
          
          nextBeatTimeRef.current += secondsPerBeat;
          beatCounter = (beatCounter + 1) % 4;
        }
        timerRef.current = setTimeout(run, 25);
      };
      run();
    };
    scheduler();
  };

  const playTick = (time: number, beat: number) => {
    const osc = audioCtx.current!.createOscillator();
    const gain = audioCtx.current!.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.current!.destination);
    osc.frequency.setValueAtTime(beat === 0 ? 880 : 440, time);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.1, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    osc.start(time);
    osc.stop(time + 0.06);
  };

  const stopAudio = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setCurrentBeat(-1);
  };

  const send = async (v: any) => {
    initAudio(); // 클릭할 때마다 오디오 상태 확인
    const startTime = v.isPlaying ? (Date.now() / 1000) : 0;
    const updated = { ...config, ...v, startTime };
    setConfig(updated);
    
    // DB 업데이트
    await supabase.from('rooms').update({ 
      bpm: updated.bpm, 
      is_playing: updated.isPlaying, 
      start_time: updated.startTime 
    }).eq('name', room);

    // Pusher 전송
    await fetch('/api/sync', { method: 'POST', body: JSON.stringify({ ...updated, teamId: room }) });
  };

  if (!joined) {
    return (
      <main style={{ minHeight: '100dvh', backgroundColor: '#F1F3F5', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 24px', fontFamily: 'sans-serif' }}>
        <h1 style={{ fontSize: '12px', letterSpacing: '5px', color: '#ADB5BD', marginBottom: '40px' }}>SHARE METRONOME</h1>
        <div style={{ width: '100%', maxWidth: '360px' }}>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '30px' }}>
            <input type="text" placeholder="NEW TEAM" onChange={e => setRoom(e.target.value)} style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid #DEE2E6' }} />
            <button onClick={() => supabase.from('rooms').insert([{ name: room }]).then(fetchRooms)} style={{ background: '#212529', color: 'white', border: 'none', padding: '0 20px', borderRadius: '8px' }}>ADD</button>
          </div>
          {rooms.map(r => (
            <div key={r.id} onClick={() => joinRoom(r)} style={{ background: 'white', padding: '20px', borderRadius: '12px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', boxShadow: '0 2px 5px rgba(0,0,0,0.05)', cursor: 'pointer' }}>
              <span style={{ fontWeight: 'bold' }}>{r.name}</span>
              <span style={{ color: r.is_playing ? '#40C057' : '#ADB5BD' }}>{r.is_playing ? '● ON' : 'OFF'}</span>
            </div>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100dvh', backgroundColor: '#F1F3F5', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <button onClick={() => { stopAudio(); setJoined(false); }} style={{ position: 'absolute', top: '20px', left: '20px', background: 'none', border: 'none', color: '#ADB5BD' }}>← LIST</button>
      <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '40px' }}>{room}</h2>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '50px' }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{ width: '40px', height: '40px', borderRadius: '50%', background: currentBeat === i ? '#212529' : 'white', border: '2px solid #DEE2E6' }} />
        ))}
      </div>
      <div style={{ fontSize: '80px', fontWeight: 'bold', marginBottom: '20px' }}>{config.bpm}</div>
      <input type="range" min="40" max="240" value={config.bpm} onChange={e => send({ bpm: Number(e.target.value), isPlaying: config.isPlaying })} style={{ width: '250px', marginBottom: '50px' }} />
      <button onClick={() => send({ isPlaying: !config.isPlaying })} style={{ width: '100px', height: '100px', borderRadius: '50%', background: config.isPlaying ? '#212529' : 'white', color: config.isPlaying ? 'white' : '#212529', border: '3px solid #212529', fontSize: '20px', fontWeight: 'bold' }}>
        {config.isPlaying ? 'STOP' : 'PLAY'}
      </button>
    </main>
  );
}