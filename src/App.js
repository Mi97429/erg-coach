import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Play, Pause, Square, RotateCcw, Activity, ChevronRight, Volume2, VolumeX, Heart, Dumbbell, Settings, Gauge } from 'lucide-react';

export default function App() {
  // --- STATE MANAGEMENT ---
  const [appState, setAppState] = useState('dashboard'); // 'dashboard', 'workout', 'finished'
  const [trainingType, setTrainingType] = useState('cardio'); // 'cardio' of 'kracht'
  const [equipmentList, setEquipmentList] = useState(['rowerg']); // Array voor meerdere toestellen
  const [strengthExercises, setStrengthExercises] = useState(['Leg Press', 'Bench Press', 'Seated Row']); // Toegevoegd: actieve strengtherg oefeningen
  const [sessionDuration, setSessionDuration] = useState(20); // Toegevoegd: sessie duur in minuten
  
  const [selectedWod, setSelectedWod] = useState(null);
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const timerRef = useRef(null);

  // --- HARDWARE SELECTIE LOGICA ---
  const toggleEquipment = (eq) => {
    setEquipmentList(prev => {
      if (prev.includes(eq)) {
        if (prev.length === 1) return prev; // Voorkom dat er 0 geselecteerd zijn
        return prev.filter(item => item !== eq);
      } else {
        return [...prev, eq];
      }
    });
  };

  const toggleStrengthExercise = (ex) => {
    setStrengthExercises(prev => {
      if (prev.includes(ex)) {
        if (prev.length === 1) return prev; // Minimaal 1 oefening behouden
        return prev.filter(item => item !== ex);
      } else {
        return [...prev, ex];
      }
    });
  };

  // --- WOD GENERATOR ENGINE (Multi-Machine Support) ---
  const generateWorkout = (type, equipArray, durationMinutes, selectedStrengthExs) => {
    
    // Bepaal welk toestel bij welk blok hoort
    const getPhaseEquip = (index) => {
      const eq = equipArray[index % equipArray.length];
      return { name: eq, isBike: eq === 'bikeerg' };
    };
    
    let basePhases = [];
    const targetTotalSeconds = durationMinutes * 60;
    
    if (type === 'cardio') {
      basePhases = [
        { name: 'Warm-up', duration: 180, type: 'warmup', damper: '3', spm: '20-22', rpm: '70-80' },
        { name: 'Endurance Base', duration: 420, type: 'work', damper: '4', spm: '24-26', rpm: '85-90' },
        { name: 'Active Recovery', duration: 120, type: 'rest', damper: '-', spm: '-', rpm: '-' },
        { name: 'Tempo Push', duration: 300, type: 'work', damper: '4-5', spm: '26-28', rpm: '90-95' },
        { name: 'Cool-Down', duration: 180, type: 'cooldown', damper: '1', spm: 'Vrij', rpm: 'Vrij' }
      ];
    } else {
      // Dynamische sets genereren voor Kracht op basis van de geselecteerde tijd
      basePhases.push({ name: 'Activatie', duration: 180, type: 'warmup', damper: '5', spm: '20', rpm: '65' });
      
      const availableSeconds = targetTotalSeconds - 360; // Trek warmup en cooldown af
      const cycleDur = 180; // 40s work + 140s rest
      const numSets = Math.max(3, Math.floor(availableSeconds / cycleDur)); // Minimaal 3 sets, meer als er meer tijd is

      for (let i = 1; i <= numSets; i++) {
        basePhases.push({ name: `Power Interval ${i}`, duration: 40, type: 'work', damper: '10', spm: '15-18', rpm: '50-60' });
        basePhases.push({ name: 'Volledig Herstel', duration: 140, type: 'rest', damper: '-', spm: '-', rpm: '-' });
      }

      basePhases.push({ name: 'Cool-Down', duration: 180, type: 'cooldown', damper: '1', spm: 'Vrij', rpm: 'Vrij' });
    }

    // --- TIJD SCHAAL LOGICA ---
    const currentTotalSeconds = basePhases.reduce((acc, p) => acc + p.duration, 0);
    const ratio = targetTotalSeconds / currentTotalSeconds;

    let scaledPhases = basePhases.map(phase => ({
      ...phase,
      duration: Math.round(phase.duration * ratio)
    }));

    // Compenseer afrondingsverschillen op de laatste fase zodat het exact klopt
    const actualTotal = scaledPhases.reduce((acc, p) => acc + p.duration, 0);
    scaledPhases[scaledPhases.length - 1].duration += (targetTotalSeconds - actualTotal);

    let equipCounter = 0;
    let tempoCounter = 0; // Toegevoegd voor variatie in reps
    // Gebruik de actieve selectie van de gebruiker (met fallback)
    const activeStrengthExercises = selectedStrengthExs && selectedStrengthExs.length > 0 ? selectedStrengthExs : ['Leg Press'];
    
    // Gebruik flatMap zodat we bij de strengtherg 1 fase kunnen uitsplitsen in meerdere oefeningen
    const mappedPhases = scaledPhases.flatMap((phase) => {
      if (phase.type !== 'rest') {
        const eqInfo = getPhaseEquip(equipCounter);
        equipCounter++;

        // Specifieke logica voor Strengtherg: voer ALLE geselecteerde oefeningen uit als een circuit
        if (eqInfo.name === 'strengtherg') {
          
          // Bepaal reps en tempo voor deze volledige reeks
          let targetReps = 10;
          let repTempo = 4;
          let speechRate = 1.1;
          let tempoLabel = ' (Normaal Tempo)';
          let currentDamper = phase.damper; // Toegevoegd voor dynamische damper

          if (phase.type === 'warmup') {
            targetReps = 12;
            repTempo = 4;
            speechRate = 1.1;
            tempoLabel = ' (Warm-up Tempo)';
            currentDamper = '3';
          } else if (phase.type === 'work') {
            targetReps = type === 'kracht' ? 8 : 15;
            
            // Variatie in tempo gesplitst per type training
            let tempoProfiles = [];
            
            if (type === 'kracht') {
              // Kracht: Wissel tussen Normaal en Traag (TUT)
              tempoProfiles = [
                { label: ' (Normaal Tempo)', tempo: 4, rate: 1.1, damper: phase.damper }, 
                { label: ' (TRAAG - TUT)', tempo: 6, rate: 0.85, damper: phase.damper } // Behoud hoge damper
              ];
            } else {
              // Cardio: Wissel tussen Normaal en Snel
              tempoProfiles = [
                { label: ' (Normaal Tempo)', tempo: 4, rate: 1.1, damper: phase.damper }, 
                { label: ' (SNEL TEMPO!)', tempo: 1.5, rate: 1.8, damper: '1-2' } // Verlaag damper drastisch voor snelheid!
              ];
            }
            
            const profile = tempoProfiles[tempoCounter % tempoProfiles.length];
            tempoCounter++;
            
            repTempo = profile.tempo;
            speechRate = profile.rate;
            tempoLabel = profile.label;
            currentDamper = profile.damper;
          } else if (phase.type === 'cooldown') {
            targetReps = 15;
            repTempo = 4;
            speechRate = 1.1;
            tempoLabel = ' (Cool-down Tempo)';
            currentDamper = '1';
          }

          let totalNewDuration = 0;
          
          // Genereer een aparte fase voor ELKE geselecteerde oefening, zonder rust ertussen
          return activeStrengthExercises.map((exercise, index) => {
            const newDuration = targetReps * repTempo;
            totalNewDuration += newDuration;
            
            return {
              ...phase,
              equipmentName: `${eqInfo.name}: ${exercise}${tempoLabel}`,
              unit: 'REPS',
              target: targetReps,
              damper: currentDamper, // Overschrijf de standaard damper met het profiel
              isRepBased: true,
              repTempo: repTempo,
              speechRate: speechRate,
              duration: newDuration,
              // Alleen de laatste oefening in het circuit geeft het tijdsverschil door aan de rustfase
              timeDiff: index === activeStrengthExercises.length - 1 ? phase.duration - totalNewDuration : 0
            };
          });

        } else {
          // Andere toestellen blijven 1-op-1
          return [{
            ...phase,
            equipmentName: eqInfo.name,
            unit: eqInfo.isBike ? 'RPM' : 'SPM',
            target: eqInfo.isBike ? phase.rpm : phase.spm,
            isRepBased: false,
            repTempo: 0,
            speechRate: 1.1
          }];
        }
      } else {
        return [{
          ...phase,
          equipmentName: 'Transitie / Rust',
          unit: '-',
          target: '-'
        }];
      }
    });

    // Compenseer de Strengtherg rep-tijd verschillen in de daaropvolgende rustfases
    for (let i = 0; i < mappedPhases.length - 1; i++) {
      if (mappedPhases[i].isRepBased && mappedPhases[i+1].type === 'rest') {
        if (mappedPhases[i].timeDiff) {
          mappedPhases[i+1].duration += mappedPhases[i].timeDiff;
        }
        // Minimaliseer extreme negatieve correcties (minimaal 15s rust behouden)
        if (mappedPhases[i+1].duration < 15) {
          mappedPhases[i+1].duration = 15;
        }
        // Zorg dat de rustperiode bij de Strengtherg maximaal 1 minuut (60 seconden) duurt
        if (mappedPhases[i+1].duration > 60) {
          mappedPhases[i+1].duration = 60;
        }
      }
    }

    // VOEG PREP FASE TOE (10 seconden aftellen)
    mappedPhases.unshift({
      name: 'Maak je klaar',
      duration: 10,
      type: 'prep',
      equipmentName: mappedPhases.length > 0 ? mappedPhases[0].equipmentName : 'Setup', // Toon het start-toestel
      unit: '-',
      target: '-',
      damper: '-',
      isRepBased: false,
      repTempo: 0,
      speechRate: 1.1
    });

    return {
      id: `${type}-circuit-${Date.now()}`,
      name: `${type.toUpperCase()} CIRCUIT`,
      phases: mappedPhases
    };
  };

  const startWorkout = () => {
    const wod = generateWorkout(trainingType, equipmentList, sessionDuration, strengthExercises);
    setSelectedWod(wod);
    setCurrentPhaseIndex(0);
    setTimeLeft(wod.phases[0].duration);
    setAppState('workout');
    setIsRunning(true);
    speakText("Get ready! Starting in 10 seconds."); // Kondig de start aan
  };

  // --- SPRAAK ENGINE (Engels & Vrouwelijk) ---
  const speakText = useCallback((text, rate = 1.0) => {
    if (!soundEnabled) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';

    // Zoek een aantrekkelijke vrouwelijke stem (afhankelijk van besturingssysteem/browser)
    const voices = window.speechSynthesis.getVoices();
    const femaleVoice = voices.find(v => 
      v.lang.startsWith('en') && 
      (v.name.includes('Female') || v.name.includes('Samantha') || v.name.includes('Victoria') || v.name.includes('Karen') || v.name.includes('Moira'))
    ) || voices.find(v => v.lang.startsWith('en'));

    if (femaleVoice) {
      utterance.voice = femaleVoice;
    }
    
    utterance.pitch = 1.2; // Iets hogere pitch voor een vriendelijkere / vrouwelijkere klank
    utterance.rate = rate;
    window.speechSynthesis.speak(utterance);
  }, [soundEnabled]);

  // --- AUDIO CUES (Web Audio API) ---
  const playBeep = useCallback((freq = 440, type = 'sine', duration = 0.3, slideTo = null, volume = 0.1) => {
    if (!soundEnabled) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      
      // Optionele 'slide' voor een moderner geluid
      if (slideTo) {
        osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + duration);
      }

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.start();
      
      // Zachtere fade-in en fade-out (voorkomt harde 'klik' geluiden), met aanpasbaar volume
      gainNode.gain.setValueAtTime(0, ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + duration);
      
      osc.stop(ctx.currentTime + duration);
    } catch (e) {
      console.log("Audio not supported");
    }
  }, [soundEnabled]);

  const playPhaseChangeSound = useCallback(() => {
    // Luid en activerend boksbel geluid ("Ting-Ting!")
    const playBell = () => {
      playBeep(850, 'sine', 1.5, null, 0.8); // Luide basis bel (Volume 0.8)
      playBeep(1700, 'triangle', 1.0, null, 0.3); // Heldere boventoon voor de "ting"
    };
    
    playBell(); // Eerste slag
    setTimeout(playBell, 200); // Tweede slag heel kort erachter
  }, [playBeep]);

  const playCountdownSound = useCallback(() => {
    // Moderne, zachte 'bliep' (slide van hoog naar laag)
    playBeep(800, 'triangle', 0.15, 400);
  }, [playBeep]);

  // --- TIMER LOGICA ---
  const currentPhase = selectedWod?.phases[currentPhaseIndex];
  const lastSpokenRepRef = useRef(null);

  useEffect(() => {
    if (isRunning && timeLeft > 0) {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (!currentPhase?.isRepBased && prev <= 4 && prev > 1) playCountdownSound();
          if (prev === 1) playPhaseChangeSound();
          return prev - 1;
        });
      }, 1000);
    } else if (isRunning && timeLeft === 0 && selectedWod) {
      if (currentPhaseIndex < selectedWod.phases.length - 1) {
        const nextIndex = currentPhaseIndex + 1;
        const nextPhaseInfo = selectedWod.phases[nextIndex];
        setCurrentPhaseIndex(nextIndex);
        setTimeLeft(nextPhaseInfo.duration);
        lastSpokenRepRef.current = null; // Reset de rep-teller voor de nieuwe fase

        // Motiverende spreuk na overgang (met lichte vertraging zodat het na de 'Level Up' sound komt)
        if (nextPhaseInfo.type === 'rest') {
          setTimeout(() => speakText("Take a breather. You're doing great!"), 800);
        } else if (nextPhaseInfo.type === 'cooldown') {
          setTimeout(() => speakText("Amazing work! Time to cool down."), 800);
        } else {
          const phrases = ["Let's go!", "You got this!", "Keep pushing!", "Awesome job, keep it up!", "Focus and push!"];
          const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];
          setTimeout(() => speakText(randomPhrase), 800);
        }

      } else {
        setIsRunning(false);
        setAppState('finished');
        playPhaseChangeSound(); // Speel het blije geluidje nog eens
        setTimeout(() => speakText("Workout complete! Outstanding performance!"), 500);
      }
    }
    return () => clearInterval(timerRef.current);
  }, [isRunning, timeLeft, currentPhaseIndex, selectedWod, playCountdownSound, playPhaseChangeSound, currentPhase, speakText]);

  // --- SPRAAK LOGICA VOOR REPS ---
  useEffect(() => {
    if (isRunning && currentPhase?.isRepBased && soundEnabled) {
      const currentRep = Math.ceil(timeLeft / currentPhase.repTempo);
      if (currentRep > 0 && lastSpokenRepRef.current !== currentRep) {
        lastSpokenRepRef.current = currentRep;
        // Gebruik de nieuwe centrale spraak engine (met juiste rate)
        speakText(currentRep.toString(), currentPhase.speechRate || 1.1);
      }
    }
  }, [timeLeft, isRunning, currentPhase, speakText, soundEnabled]);

  // --- HANDLERS ---
  const toggleTimer = () => setIsRunning(!isRunning);
  
  const returnToDashboard = () => {
    setIsRunning(false);
    setAppState('dashboard');
  };

  const skipPhase = () => {
    if (!selectedWod) return;
    if (currentPhaseIndex < selectedWod.phases.length - 1) {
      const nextIndex = currentPhaseIndex + 1;
      setCurrentPhaseIndex(nextIndex);
      setTimeLeft(selectedWod.phases[nextIndex].duration);
      playPhaseChangeSound();
    } else {
      setTimeLeft(0);
    }
  };

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Subtiele achtergrond gloed op basis van fase
  const getPhaseBgColor = (type) => {
    switch(type) {
      case 'prep': return 'bg-[#1a1505]'; // Donker geel/goud
      case 'work': return 'bg-[#1a0505]'; // Zeer donker rood
      case 'rest': return 'bg-[#051a0d]'; // Zeer donker groen
      default: return 'bg-black'; // Zwart voor maximaal contrast
    }
  };

  const getPhaseTextColor = (type) => {
    switch(type) {
      case 'prep': return 'text-yellow-500';
      case 'work': return 'text-red-500';
      case 'rest': return 'text-green-500';
      case 'warmup': return 'text-orange-500';
      case 'cooldown': return 'text-blue-500';
      default: return 'text-white';
    }
  };

  // --- RENDER DASHBOARD ---
  if (appState === 'dashboard') {
    return (
      <div className="min-h-screen bg-black text-white font-sans flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full space-y-8">
          
          <div className="text-center space-y-2">
            <div className="flex justify-center items-center gap-2 text-red-500 mb-4">
              <Activity size={32} className="animate-pulse" />
            </div>
            <h1 className="text-4xl font-black uppercase tracking-tight">Erg Coach</h1>
            <p className="text-gray-400">Configureer je sessie</p>
          </div>

          {/* TYPE SELECTIE */}
          <div className="space-y-3">
            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-widest ml-1">1. Trainingsprikkel</h2>
            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={() => setTrainingType('cardio')}
                className={`flex flex-col items-center justify-center p-6 rounded-2xl border-4 transition-all ${trainingType === 'cardio' ? 'border-red-600 bg-red-900/30 text-white shadow-[0_0_20px_rgba(220,38,38,0.4)]' : 'border-gray-800 bg-gray-950 text-gray-500 hover:border-gray-600'}`}
              >
                <Heart size={36} className={`mb-3 ${trainingType === 'cardio' ? 'text-red-500' : ''}`} />
                <span className="font-bold uppercase tracking-wider">Cardio</span>
              </button>
              <button 
                onClick={() => setTrainingType('kracht')}
                className={`flex flex-col items-center justify-center p-6 rounded-2xl border-4 transition-all ${trainingType === 'kracht' ? 'border-blue-600 bg-blue-900/30 text-white shadow-[0_0_20px_rgba(37,99,235,0.4)]' : 'border-gray-800 bg-gray-950 text-gray-500 hover:border-gray-600'}`}
              >
                <Dumbbell size={36} className={`mb-3 ${trainingType === 'kracht' ? 'text-blue-500' : ''}`} />
                <span className="font-bold uppercase tracking-wider">Kracht</span>
              </button>
            </div>
          </div>

          {/* HARDWARE SELECTIE (MULTIPLE) */}
          <div className="space-y-3">
            <div className="flex justify-between items-end ml-1">
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-widest">2. Hardware Stack</h2>
              <span className="text-xs text-gray-600 font-medium">Selecteer 1 of meer</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {['rowerg', 'skierg', 'bikeerg', 'strengtherg'].map(eq => {
                const isSelected = equipmentList.includes(eq);
                return (
                  <button
                    key={eq}
                    onClick={() => toggleEquipment(eq)}
                    className={`p-4 rounded-xl border-2 text-center font-bold uppercase text-sm tracking-wide transition-all ${isSelected ? 'border-white bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.5)]' : 'border-gray-800 bg-gray-950 text-gray-500 hover:bg-gray-800 hover:text-white'}`}
                  >
                    {eq}
                  </button>
                )
              })}
            </div>
          </div>

          {/* STRENGTH OEFENINGEN SELECTIE (Conditioneel) */}
          {equipmentList.includes('strengtherg') && (
            <div className="space-y-3 animate-fade-in">
              <div className="flex justify-between items-end ml-1">
                <h2 className="text-sm font-bold text-gray-500 uppercase tracking-widest">3. Strengtherg Oefeningen</h2>
                <span className="text-xs text-gray-600 font-medium">Kies er 1 of meer</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {['Leg Press', 'Bench Press', 'Seated Row'].map(ex => {
                  const isSelected = strengthExercises.includes(ex);
                  return (
                    <button
                      key={ex}
                      onClick={() => toggleStrengthExercise(ex)}
                      className={`p-3 rounded-xl border-2 text-center font-bold uppercase text-xs tracking-wide transition-all ${isSelected ? 'border-blue-500 bg-blue-900/30 text-white shadow-[0_0_10px_rgba(59,130,246,0.3)]' : 'border-gray-800 bg-gray-950 text-gray-500 hover:bg-gray-800 hover:text-white'}`}
                    >
                      {ex}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* SESSIE DUUR SELECTIE */}
          <div className="space-y-4">
            <div className="flex justify-between items-end ml-1">
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-widest">
                {equipmentList.includes('strengtherg') ? '4. Sessie Duur' : '3. Sessie Duur'}
              </h2>
              <span className="text-2xl font-black text-white">{sessionDuration} <span className="text-sm text-gray-500">MIN</span></span>
            </div>
            <input 
              type="range" 
              min="10" 
              max="60" 
              step="5" 
              value={sessionDuration} 
              onChange={(e) => setSessionDuration(Number(e.target.value))}
              className="w-full h-3 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-red-600"
            />
            <div className="flex justify-between text-xs text-gray-600 font-bold px-1">
              <span>10m</span>
              <span>30m</span>
              <span>60m</span>
            </div>
          </div>

          {/* START BUTTON */}
          <button 
            onClick={startWorkout}
            className="w-full mt-8 bg-red-600 hover:bg-red-500 text-white font-black text-2xl py-6 rounded-2xl uppercase tracking-widest shadow-[0_0_40px_rgba(220,38,38,0.5)] transition-transform active:scale-95 flex items-center justify-center gap-3"
          >
            Start Sessie <Play className="fill-current w-8 h-8" />
          </button>
          
        </div>
      </div>
    );
  }

  // --- PREPARE DATA FOR WORKOUT/FINISHED VIEWS ---
  const nextPhase = selectedWod?.phases[currentPhaseIndex + 1];

  return (
    <div className={`min-h-screen ${currentPhase ? getPhaseBgColor(currentPhase.type) : 'bg-black'} transition-colors duration-700 flex flex-col font-sans`}>
      
      {/* HEADER */}
      <header className="p-4 flex justify-between items-center z-10 border-b border-white/5 bg-black/50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <button onClick={returnToDashboard} className="text-gray-500 hover:text-white transition">
            <Square size={24} />
          </button>
          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest border border-gray-700 px-3 py-1 rounded-full">
            {selectedWod?.name}
          </div>
        </div>
        <button onClick={() => setSoundEnabled(!soundEnabled)} className="text-gray-500 hover:text-white transition">
          {soundEnabled ? <Volume2 size={28} /> : <VolumeX size={28} />}
        </button>
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col p-4 max-w-5xl mx-auto w-full justify-center text-center">
        
        {appState === 'finished' ? (
          <div className="animate-fade-in space-y-6 flex flex-col items-center">
            <Activity size={100} className="text-green-500 mb-4" />
            <h2 className="text-6xl md:text-8xl font-black text-green-400 uppercase tracking-tight leading-none">Sessie<br/>Voltooid</h2>
            <p className="text-2xl text-gray-400 mt-4">Tijd voor herstel.</p>
            <button 
              onClick={returnToDashboard}
              className="mt-12 flex items-center gap-2 bg-white text-black px-10 py-5 rounded-full font-black text-2xl uppercase tracking-widest hover:bg-gray-200 transition-transform active:scale-95 shadow-2xl"
            >
              Terug naar Start
            </button>
          </div>
        ) : (
          currentPhase && (
            <div className="flex flex-col items-center w-full justify-center flex-1 py-4">
              
              {/* FASE & EQUIPMENT INFO */}
              <div className="space-y-2 mb-2 md:mb-6 w-full flex flex-col items-center">
                <h2 className={`text-4xl md:text-6xl lg:text-7xl font-black uppercase tracking-tight ${getPhaseTextColor(currentPhase.type)}`}>
                  {currentPhase.name}
                </h2>
                
                {/* Welk toestel nu? */}
                <div className="text-2xl md:text-5xl lg:text-6xl font-black text-black bg-white px-8 py-2 md:py-4 rounded-full inline-block border-4 border-gray-300 shadow-[0_0_30px_rgba(255,255,255,0.3)] mt-2">
                  {currentPhase.equipmentName.toUpperCase()}
                </div>
              </div>

              {/* GIGANTISCHE TIMER OF REPS */}
              <div className="w-full flex justify-center items-center my-4 md:my-8">
                {currentPhase.isRepBased ? (
                  <div className="text-[25vw] sm:text-[18rem] md:text-[22rem] lg:text-[26rem] font-black leading-none tracking-tighter tabular-nums text-white drop-shadow-[0_0_40px_rgba(255,255,255,0.5)]">
                    {Math.ceil(timeLeft / currentPhase.repTempo)}
                  </div>
                ) : (
                  <div className={`text-[25vw] sm:text-[18rem] md:text-[22rem] lg:text-[26rem] font-black font-mono leading-none tracking-tighter tabular-nums text-white drop-shadow-[0_0_20px_rgba(255,255,255,0.3)] ${timeLeft <= 10 && currentPhase.type === 'work' ? 'text-red-500 animate-pulse drop-shadow-[0_0_40px_rgba(239,68,68,0.6)]' : ''}`}>
                    {formatTime(timeLeft)}
                  </div>
                )}
              </div>

              {/* GIGANTISCHE TARGET METRICS (DAMPER & RPM) - Verborgen in rust en prep fase */}
              {currentPhase.type !== 'rest' && currentPhase.type !== 'prep' ? (
                <div className="flex gap-4 md:gap-8 justify-center w-full max-w-4xl mt-4">
                  
                  {/* Damper Badge - HIGH CONTRAST */}
                  <div className="flex-1 bg-black border-4 border-[#FFD700] rounded-[2rem] p-4 md:p-8 flex flex-col items-center justify-center shadow-[0_0_40px_rgba(255,215,0,0.15)] relative overflow-hidden">
                    <div className="absolute top-2 left-0 w-full flex justify-center items-center gap-2 opacity-80">
                      <Settings size={20} className="text-[#FFD700]" />
                      <span className="text-lg md:text-2xl font-black uppercase tracking-widest text-[#FFD700]">Damper</span>
                    </div>
                    <div className="text-7xl md:text-9xl lg:text-[10rem] font-black text-[#FFD700] mt-6 leading-none tracking-tighter">
                      {currentPhase.damper}
                    </div>
                  </div>

                  {/* RPM/SPM Badge - HIGH CONTRAST */}
                  <div className="flex-1 bg-black border-4 border-[#00FFFF] rounded-[2rem] p-4 md:p-8 flex flex-col items-center justify-center shadow-[0_0_40px_rgba(0,255,255,0.15)] relative overflow-hidden">
                    <div className="absolute top-2 left-0 w-full flex justify-center items-center gap-2 opacity-80">
                      <Gauge size={20} className="text-[#00FFFF]" />
                      <span className="text-lg md:text-2xl font-black uppercase tracking-widest text-[#00FFFF]">Target {currentPhase.unit}</span>
                    </div>
                    <div className="text-7xl md:text-9xl lg:text-[10rem] font-black text-[#00FFFF] mt-6 leading-none tracking-tighter">
                      {currentPhase.target}
                    </div>
                  </div>

                </div>
              ) : currentPhase.type === 'rest' ? (
                <div className="text-4xl md:text-6xl lg:text-7xl font-black text-green-500 mt-12 uppercase tracking-widest opacity-80 animate-pulse">
                  Adem In. Adem Uit.
                </div>
              ) : (
                <div className="text-4xl md:text-6xl lg:text-7xl font-black text-yellow-500 mt-12 uppercase tracking-widest opacity-80 animate-pulse">
                  Zet je klaar!
                </div>
              )}
            </div>
          )
        )}
      </main>

      {/* CONTROLS (Onderaan) */}
      {appState === 'workout' && (
        <div className="p-4 pb-8 flex justify-center items-center gap-8 md:gap-16 z-10 bg-gradient-to-t from-black via-black/80 to-transparent pt-12">
          <button 
            onClick={returnToDashboard}
            className="p-5 rounded-full bg-gray-900 border-2 border-gray-700 text-gray-300 hover:bg-gray-800 hover:border-white hover:text-white transition active:scale-90"
          >
            <RotateCcw size={32} />
          </button>
          
          <button 
            onClick={toggleTimer}
            className={`w-32 h-32 md:w-40 md:h-40 rounded-full flex items-center justify-center text-white shadow-[0_0_50px_rgba(0,0,0,0.5)] transition-transform active:scale-90 border-4 ${isRunning ? 'bg-orange-600 border-orange-400 hover:bg-orange-500' : 'bg-red-600 border-red-400 hover:bg-red-500'}`}
          >
            {isRunning ? <Pause size={64} className="fill-current" /> : <Play size={64} className="fill-current translate-x-2" />}
          </button>
          
          <button 
            onClick={skipPhase}
            className="p-5 rounded-full bg-gray-900 border-2 border-gray-700 text-gray-300 hover:bg-gray-800 hover:border-white hover:text-white transition active:scale-90"
          >
            <ChevronRight size={32} />
          </button>
        </div>
      )}
    </div>
  );
}
