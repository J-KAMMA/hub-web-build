import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline";
import "@babylonjs/core/Rendering/prePassRendererSceneComponent";
import "@babylonjs/core/Rendering/geometryBufferRendererSceneComponent";
import type { Scene } from "@babylonjs/core/scene";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { buildSkyline } from "./skyline";
import { createStreetEnvironment } from "./surfaces";
import { ReflectionProbe } from "@babylonjs/core/Probes/reflectionProbe";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";

/** Original procedural atmosphere: no images, environment maps, or model downloads. */
export function createAtmosphere(scene: Scene, camera: Camera) {
  createStreetEnvironment(scene);
  buildSkyline(scene);
  scene.clearColor = new Color4(0.66, 0.8, 0.84, 1);
  scene.fogMode = 3;
  scene.fogStart = 110;
  scene.fogEnd = 460;
  scene.fogColor = new Color3(0.75, 0.78, 0.76);
  const sky = CreateSphere("coast:sky", { diameter: 900, segments: 24 }, scene);
  sky.isPickable = false;
  sky.infiniteDistance = true;
  const skyMaterial = new ShaderMaterial("coast:sky-gradient", scene, {
    vertexSource: `precision highp float; attribute vec3 position; uniform mat4 worldViewProjection;
      varying vec3 direction; void main(){ direction=normalize(position); gl_Position=worldViewProjection*vec4(position,1.0); }`,
    fragmentSource: `precision highp float; varying vec3 direction;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      void main(){ vec3 d=normalize(direction); float h=max(d.y,0.0);
        vec3 horizon=vec3(0.82,0.80,0.72), zenith=vec3(0.19,0.40,0.64);
        vec3 color=mix(horizon,zenith,pow(h,0.48));
        vec2 p=d.xz/max(d.y+0.14,0.08)*3.0;
        float clouds=noise(p)*0.55+noise(p*2.1)*0.28+noise(p*4.3)*0.12+noise(p*8.7)*0.05;
        float cloud=smoothstep(0.52,0.77,clouds)*smoothstep(0.0,0.22,h);
        color=mix(color,vec3(0.88,0.86,0.80),cloud*0.85);
        float glow=pow(max(dot(d,normalize(vec3(-0.45,0.35,0.6))),0.0),12.0);
        color+=vec3(0.15,0.09,0.025)*glow;
        gl_FragColor=vec4(color,1.0); }`
  }, { attributes: ["position"], uniforms: ["worldViewProjection"] });
  skyMaterial.backFaceCulling = false;
  skyMaterial.disableDepthWrite = true;
  sky.material = skyMaterial;
  sky.renderingGroupId = 0;

  const sea = CreateGround("coast:sea", { width: 850, height: 850, subdivisions: 100 }, scene);
  sea.position.y = -2.3;
  sea.isPickable = false;
  const water = new ShaderMaterial("coast:living-water", scene, {
    vertexSource: `precision highp float; attribute vec3 position; uniform mat4 worldViewProjection; uniform mat4 world;
      uniform float time; uniform float waveScale; varying vec3 at; varying float wave;
      void main(){ vec3 p=position; wave=(sin(p.x*0.1+time*0.55)*0.14+sin(p.z*0.17-time*0.38)*0.09)*waveScale;
        p.y+=wave; at=(world*vec4(p,1.0)).xyz; gl_Position=worldViewProjection*vec4(p,1.0); }`,
    fragmentSource: `precision highp float; uniform float time; uniform vec3 eye; varying vec3 at; varying float wave;
      void main(){
        float dx=cos(at.x*0.1+time*0.55)*0.014+cos((at.x+at.z)*0.85+time)*0.021;
        float dz=cos(at.z*0.17-time*0.38)*0.015+sin(at.z*0.61-time)*0.02;
        vec3 n=normalize(vec3(-dx,1.0,-dz)); vec3 v=normalize(eye-at);
        float fresnel=pow(1.0-max(dot(n,v),0.0),3.0);
        vec3 deep=vec3(0.055,0.34,0.37), reflection=vec3(0.65,0.78,0.78);
        vec3 color=mix(deep,reflection,fresnel*0.76);
        float sparkle=pow(max(dot(reflect(-normalize(vec3(-0.4,0.65,0.6)),n),v),0.0),160.0);
        color+=vec3(1.0,0.83,0.5)*sparkle*1.6;
        float ripple=sin(at.x*1.5+at.z*0.7+sin(at.z*0.3+time))*sin(at.z*1.9-time*0.8);
        color+=ripple*0.012; color+=wave*0.05;
        gl_FragColor=vec4(color,1.0); }`
  }, { attributes: ["position"], uniforms: ["worldViewProjection", "world", "time", "eye", "waveScale"] });
  water.setFloat("time", 0);
  water.setFloat("waveScale", 1);
  water.setVector3("eye", camera.globalPosition);
  sea.material = water;
  const basinWater = water.clone("coast:fountain-water");
  basinWater.setFloat("waveScale", 0.06);

  const rock = new StandardMaterial("coast:limestone", scene);
  rock.diffuseColor = Color3.FromHexString("#a6967b");
  rock.specularColor.set(0, 0, 0);
  const island = CreateCylinder("coast:foundation", { diameterTop: 130, diameterBottom: 137, height: 4.8, tessellation: 96 }, scene);
  island.position.y = -2.44;
  island.material = rock;
  island.receiveShadows = true;
  island.isPickable = false;
  island.freezeWorldMatrix();

  // Low, distant islands anchor the sea horizon without enclosing the courtyard.
  for (let i = 0; i < 7; i++) {
    const island = CreateSphere(`coast:distant-island-${i}`, { diameter: 1, segments: 8 }, scene);
    island.scaling.set(38 + i * 7, 11 + (i % 3) * 7, 28 + i * 4);
    island.position.set(-220 + i * 71, -5.8, 210 + Math.sin(i * 2) * 48);
    island.material = rock;
    island.isPickable = false;
    island.freezeWorldMatrix();
  }

  const ao = SSAO2RenderingPipeline.IsSupported
    ? new SSAO2RenderingPipeline("street:contact-shadows", scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [camera]) : null;
  if (ao) { ao.radius = 0.65; ao.totalStrength = 0.65; ao.samples = 16; ao.maxZ = 75; }
  const pipeline = new DefaultRenderingPipeline("coast:film", true, scene, [camera]);
  pipeline.samples = 1;
  pipeline.fxaaEnabled = true;
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 1.1;
  pipeline.bloomWeight = 0.08;
  pipeline.bloomKernel = 32;
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  scene.imageProcessingConfiguration.exposure = 1.05;
  scene.imageProcessingConfiguration.contrast = 1.06;
  let time = 0;
  let reflection: ReflectionProbe | null = null;
  return {
    refreshWater() {
      reflection?.dispose(); reflection = null;
      const glass = scene.materials.filter((material): material is PBRMaterial => material instanceof PBRMaterial && /glass/i.test(material.name));
      if (glass.length) {
        reflection = new ReflectionProbe("street:window-reflection", 256, scene);
        reflection.position.set(0, 3.5, 16);
        reflection.refreshRate = 0;
        reflection.renderList = scene.meshes.filter(mesh => !glass.includes(mesh.material as PBRMaterial) && mesh.isEnabled());
        for (const material of glass) material.reflectionTexture = reflection.cubeTexture;
      }
      for (const mesh of scene.meshes) {
        if (mesh.name.includes("fountain-water")) {
          mesh.material = basinWater;
          mesh.metadata = { castShadow: false };
          mesh.receiveShadows = false;
        }
      }
    },
    update(delta: number) {
      time += Math.min(delta, 0.05);
      water.setFloat("time", time);
      water.setVector3("eye", camera.globalPosition);
      basinWater.setFloat("time", time);
      basinWater.setVector3("eye", camera.globalPosition);
    },
    dispose() { reflection?.dispose(); ao?.dispose(); pipeline.dispose(); }
  };
}
