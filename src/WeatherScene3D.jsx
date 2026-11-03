import React, { Component, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Sparkles, Stars } from '@react-three/drei';
import * as THREE from 'three';
import { weatherDescription } from './weather.js';

class SceneErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('The 3D weather scene could not be rendered:', error);
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

function CloudCluster({ position, scale = 1, mood, reducedMotion }) {
  const group = useRef(null);
  const cloudyMaterial = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: mood === 'stormy' || mood === 'rainy' ? '#9aabb7' : '#f1ead7',
    roughness: 0.65,
    metalness: 0.04,
    clearcoat: 0.3,
    clearcoatRoughness: 0.55,
  }), [mood]);

  useFrame(({ clock }) => {
    if (group.current && !reducedMotion) group.current.position.x = position[0] + Math.sin(clock.elapsedTime * 0.26 + position[0]) * 0.12;
  });

  return (
    <group ref={group} position={position} scale={scale}>
      <mesh position={[-0.48, -0.13, 0]} material={cloudyMaterial} castShadow>
        <sphereGeometry args={[0.53, 24, 18]} />
      </mesh>
      <mesh position={[0, 0.18, 0.04]} material={cloudyMaterial} castShadow>
        <sphereGeometry args={[0.66, 24, 18]} />
      </mesh>
      <mesh position={[0.53, -0.12, 0]} material={cloudyMaterial} castShadow>
        <sphereGeometry args={[0.5, 24, 18]} />
      </mesh>
      <mesh position={[0.08, -0.31, 0.03]} scale={[1.3, 0.55, 0.76]} material={cloudyMaterial} receiveShadow>
        <sphereGeometry args={[0.55, 24, 18]} />
      </mesh>
    </group>
  );
}

function StormLight({ reducedMotion }) {
  const light = useRef(null);

  useFrame(({ clock }) => {
    if (!light.current || reducedMotion) return;
    const cycle = clock.elapsedTime % 6;
    light.current.intensity = cycle > 2.4 && cycle < 2.62 ? 7 : cycle > 2.78 && cycle < 2.92 ? 4 : 0;
  });

  return <pointLight ref={light} position={[0.5, -0.5, 2]} color="#c6d9ff" intensity={0} distance={8} />;
}

function Precipitation({ snowy, reducedMotion }) {
  const points = useRef(null);
  const count = snowy ? 100 : 170;
  const positions = useMemo(() => {
    const values = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      values[i * 3] = (Math.random() - 0.5) * 5.8;
      values[i * 3 + 1] = Math.random() * 3.8 - 1.6;
      values[i * 3 + 2] = (Math.random() - 0.5) * 2.4;
    }
    return values;
  }, [count]);

  useFrame((_, delta) => {
    if (!points.current || reducedMotion) return;
    const position = points.current.geometry.attributes.position;
    for (let i = 0; i < count; i += 1) {
      const index = i * 3 + 1;
      position.array[index] -= delta * (snowy ? 0.48 : 3.7);
      if (position.array[index] < -1.7) position.array[index] = 2.2;
      if (snowy) position.array[i * 3] += Math.sin(position.array[index] * 2 + i) * delta * 0.08;
    }
    position.needsUpdate = true;
  });

  return (
    <points ref={points} position={[0, 0, 1]}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
      <pointsMaterial
        color={snowy ? '#e5f4f4' : '#9dd7df'}
        size={snowy ? 0.055 : 0.025}
        transparent
        opacity={snowy ? 0.85 : 0.72}
        sizeAttenuation
      />
    </points>
  );
}

function WeatherWorld({ mood, isDay, reducedMotion }) {
  const world = useRef(null);
  const { pointer } = useMemo(() => ({ pointer: new THREE.Vector2() }), []);
  const orbitMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: isDay ? '#efd5a1' : '#a9d8e5',
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide,
  }), [isDay]);

  useFrame(({ pointer: cursor }, delta) => {
    if (!world.current || reducedMotion) return;
    pointer.copy(cursor);
    world.current.rotation.y = THREE.MathUtils.damp(world.current.rotation.y, pointer.x * 0.14, 3, delta);
    world.current.rotation.x = THREE.MathUtils.damp(world.current.rotation.x, -pointer.y * 0.09, 3, delta);
    world.current.position.y = Math.sin(performance.now() * 0.00055) * 0.07;
  });

  const hasClouds = ['cloudy', 'rainy', 'stormy', 'snowy'].includes(mood);
  const showSun = isDay && mood !== 'stormy' && mood !== 'rainy' && mood !== 'snowy';
  const skyColor = isDay ? '#d5e9dd' : '#d9e3ed';

  return (
    <>
      <color attach="background" args={[skyColor]} />
      <fog attach="fog" args={[skyColor, 8, 15]} />
      <ambientLight intensity={isDay ? 1.65 : 0.72} color={isDay ? '#d9e8d9' : '#b4d4e4'} />
      <directionalLight position={[-4, 5, 6]} intensity={3.1} color={isDay ? '#f5d9a1' : '#b4e2f5'} />
      <pointLight position={[2.8, 1.4, -1]} intensity={1.4} distance={8} color={mood === 'stormy' ? '#b5caff' : '#93d9ce'} />
      <group ref={world}>
        {showSun && (
          <group position={[0.85, 0.55, -0.25]}>
            <mesh>
              <sphereGeometry args={[0.76, 48, 48]} />
              <meshPhysicalMaterial color="#ffe4a3" emissive="#efb95e" emissiveIntensity={2.2} roughness={0.28} metalness={0.03} clearcoat={1} />
            </mesh>
            <mesh scale={1.17}>
              <sphereGeometry args={[0.76, 32, 32]} />
              <meshBasicMaterial color="#f4d18a" transparent opacity={0.08} side={THREE.BackSide} />
            </mesh>
            <mesh rotation={[0.55, 0.15, 0.35]} material={orbitMaterial}>
              <torusGeometry args={[1.04, 0.012, 8, 100]} />
            </mesh>
            <mesh rotation={[1.05, 0.45, -0.28]} material={orbitMaterial}>
              <torusGeometry args={[1.25, 0.008, 8, 100]} />
            </mesh>
          </group>
        )}
        {!isDay && mood !== 'stormy' && mood !== 'rainy' && (
          <mesh position={[0.78, 0.63, -0.2]}>
            <sphereGeometry args={[0.68, 40, 40]} />
              <meshPhysicalMaterial color="#b4cbd2" emissive="#526d82" emissiveIntensity={0.23} roughness={0.7} metalness={0.08} clearcoat={0.2} />
          </mesh>
        )}
          {!isDay && mood !== 'stormy' && mood !== 'rainy' && (
            <group position={[0.78, 0.63, -0.2]}>
              {[[0.15, 0.2, 0.632], [-0.24, -0.14, 0.62], [0.32, -0.26, 0.542]].map(([x, y, z]) => (
                <mesh key={`${x}-${y}`} position={[x, y, z]} scale={[1, 1, 0.09]}>
                  <sphereGeometry args={[0.085, 16, 12]} />
                  <meshStandardMaterial color="#829aa3" roughness={0.98} />
                </mesh>
              ))}
            </group>
          )}
          {hasClouds && (
            <>
              <CloudCluster position={[-0.18, 0.32, 0.38]} scale={0.9} mood={mood} reducedMotion={reducedMotion} />
              <CloudCluster position={[-1.28, -0.45, -0.62]} scale={0.62} mood={mood} reducedMotion={reducedMotion} />
            </>
          )}
          <group position={[0, -1.65, -0.6]}>
            <mesh position={[0, -0.58, -0.5]} scale={[1.75, 0.42, 0.66]}>
              <sphereGeometry args={[1.8, 36, 24]} />
              <meshStandardMaterial color={isDay ? '#526c5d' : '#263e42'} roughness={0.88} metalness={0.08} />
            </mesh>
            <mesh position={[-1.16, -0.04, -0.18]} rotation={[0, 0, -0.12]}>
              <coneGeometry args={[0.64, 1.36, 6]} />
              <meshStandardMaterial color={isDay ? '#71806b' : '#405654'} roughness={0.9} flatShading />
            </mesh>
            <mesh position={[0.14, 0.08, -0.3]} rotation={[0, 0, 0.1]}>
              <coneGeometry args={[0.78, 1.52, 7]} />
              <meshStandardMaterial color={isDay ? '#829073' : '#49605d'} roughness={0.9} flatShading />
            </mesh>
            <mesh position={[1.28, -0.06, -0.18]}>
              <coneGeometry args={[0.56, 1.18, 6]} />
              <meshStandardMaterial color={isDay ? '#627b6b' : '#344c4f'} roughness={0.9} flatShading />
            </mesh>
          </group>
          {mood === 'sunny' && <Sparkles count={42} scale={[4.5, 3.2, 1.8]} size={2.1} speed={reducedMotion ? 0 : 0.28} color="#f6db9d" opacity={0.54} />}
          {mood === 'stormy' && <Sparkles count={24} scale={[4, 2.8, 1.6]} size={3.2} speed={reducedMotion ? 0 : 0.8} color="#bdceff" opacity={0.85} />}
          {mood === 'stormy' && <StormLight reducedMotion={reducedMotion} />}
        {(mood === 'rainy' || mood === 'stormy' || mood === 'snowy') && (
          <Precipitation snowy={mood === 'snowy'} reducedMotion={reducedMotion} />
        )}
      </group>
      {!isDay && <Stars radius={22} depth={7} count={100} factor={1.1} saturation={0.1} fade speed={reducedMotion ? 0 : 0.15} />}
    </>
  );
}

function WeatherVideoFallback() {
  return <picture className="weather-scene-fallback"><source media="(prefers-reduced-motion: reduce)" srcSet="/weather-scene-poster.png" /><img src="/weather-scene.gif" alt="" aria-hidden="true" /></picture>;
}

export default function WeatherScene3D({ code, isDay, reducedMotion, humidity, windSpeed, windUnit }) {
  const [webglAvailable, setWebglAvailable] = useState(false);
  const mood = weatherDescription(code).mood;
  const fallback = <WeatherVideoFallback />;

  useEffect(() => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') || canvas.getContext('webgl');
    setWebglAvailable(Boolean(context));
    const extension = context?.getExtension('WEBGL_lose_context');
    extension?.loseContext();
  }, []);

  if (!webglAvailable) return fallback;

  return (
    <SceneErrorBoundary fallback={fallback}>
      <div className={`weather-scene-3d${isDay ? '' : ' night'} mood-${mood}`} role="img" aria-label={`${weatherDescription(code).label} shown as a 3D weather scene`}>
        <Canvas
          camera={{ position: [0, 0, 6.7], fov: 36 }}
          dpr={[1, 1.25]}
          gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
          aria-hidden="true"
        >
          <WeatherWorld mood={mood} isDay={isDay} reducedMotion={reducedMotion} />
          <OrbitControls
            enablePan={false}
            enableZoom={false}
            minAzimuthAngle={-0.42}
            maxAzimuthAngle={0.42}
            minPolarAngle={1.18}
            maxPolarAngle={1.94}
            rotateSpeed={0.46}
            autoRotate={!reducedMotion}
            autoRotateSpeed={0.32}
          />
        </Canvas>
        <div className="scene-float scene-float-top"><span>ATMOSPHERE</span><strong>LIVE <i /></strong></div>
        <div className="scene-float scene-float-bottom"><span>HUMIDITY</span><strong>{humidity}%</strong><i style={{ '--humidity': `${humidity}%` }} /></div>
        <div className="scene-float scene-float-wind"><span>WIND VELOCITY</span><strong>{windSpeed} <small>{windUnit}</small></strong></div>
      </div>
    </SceneErrorBoundary>
  );
}
