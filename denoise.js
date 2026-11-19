'use strict';
// Local spectral subtraction. The selected region supplies a stationary noise profile.
// Windowed overlap-add ensures the processed signal does not contain frame boundaries.
function fft(re, im, inverse=false) {
  const n = re.length;
  for (let i=1,j=0;i<n;i++) {
    let bit=n>>1; for (;j&bit;bit>>=1) j^=bit; j^=bit;
    if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t}
  }
  for(let len=2;len<=n;len<<=1){
    const angle=(inverse?2:-2)*Math.PI/len, wr0=Math.cos(angle), wi0=Math.sin(angle);
    for(let i=0;i<n;i+=len){let wr=1,wi=0;for(let j=0;j<len/2;j++){
      const a=i+j,b=a+len/2, tr=wr*re[b]-wi*im[b],ti=wr*im[b]+wi*re[b];
      re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;
      const next=wr*wr0-wi*wi0;wi=wr*wi0+wi*wr0;wr=next;
    }}
  }
  if(inverse)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n}
}
function nextTurn(){return new Promise(resolve=>setTimeout(resolve,0))}
async function suppressNoise(input, start, end, strength, progress) {
  const n=2048, hop=512, channels=input.numberOfChannels, len=input.length;
  const window=Float32Array.from({length:n},(_,i)=>Math.sin(Math.PI*(i+.5)/n));
  const profileStart=Math.floor(start*input.sampleRate),profileEnd=Math.min(len,Math.floor(end*input.sampleRate));
  const power=new Float64Array(n/2+1), re=new Float64Array(n), im=new Float64Array(n);
  let frames=0;
  for(let ch=0;ch<channels;ch++){
    const data=input.getChannelData(ch);
    for(let pos=profileStart;pos+n<=profileEnd;pos+=hop){
      for(let i=0;i<n;i++){re[i]=data[pos+i]*window[i];im[i]=0}fft(re,im);
      for(let k=0;k<=n/2;k++)power[k]+=re[k]*re[k]+im[k]*im[k];frames++;
      if(frames%100===0)await nextTurn();
    }
  }
  if(!frames)throw Error('Слишком короткий образец шума. Выделите хотя бы полсекунды.');
  for(let k=0;k<power.length;k++)power[k]/=frames;
  const output=ctx().createBuffer(channels,len,input.sampleRate), norm=new Float32Array(len);
  // sqrt-Hann analysis and synthesis windows; compute normalization once.
  for(let pos=-n+hop;pos<len;pos+=hop)for(let i=Math.max(0,-pos);i<Math.min(n,len-pos);i++)norm[pos+i]+=window[i]*window[i];
  const totalFrames=Math.ceil((len+n-hop)/hop)*channels;let done=0;
  const amount=strength/100, floor=1-amount*.88, subtraction=amount*2.5;
  for(let ch=0;ch<channels;ch++){
    const data=input.getChannelData(ch),out=output.getChannelData(ch);
    for(let pos=-n+hop;pos<len;pos+=hop){
      for(let i=0;i<n;i++){const index=pos+i;re[i]=(index>=0&&index<len?data[index]:0)*window[i];im[i]=0}
      fft(re,im);
      for(let k=0;k<=n/2;k++){
        const p=re[k]*re[k]+im[k]*im[k];
        const gain=Math.max(floor, Math.sqrt(Math.max(0,1-subtraction*power[k]/Math.max(p,1e-20))));
        re[k]*=gain;im[k]*=gain;
        if(k>0&&k<n/2){re[n-k]*=gain;im[n-k]*=gain}
      }
      fft(re,im,true);
      for(let i=Math.max(0,-pos);i<Math.min(n,len-pos);i++)out[pos+i]+=re[i]*window[i];
      done++;
      if(done%40===0){progress(Math.min(99,Math.round(done/totalFrames*100)));await nextTurn()}
    }
    for(let i=0;i<len;i++)out[i]=norm[i]>1e-8?out[i]/norm[i]:data[i];
  }
  return output;
}
els.noiseStrength.oninput=()=>{els.noiseValue.textContent=els.noiseStrength.value+'%'};
els.denoise.onclick=async()=>{
  if(!buffer||!selection||processing)return;
  const duration=selection[1]-selection[0], strength=Number(els.noiseStrength.value);
  if(duration<.5){notify('Выделите хотя бы полсекунды фонового шума без речи.');return}
  if(duration>30){notify('Выделите не более 30 секунд только фонового шума.');return}
  if(!strength){notify('Увеличьте силу шумоподавления выше 0%.');return}
  stopPlay(); const original=buffer, originalMarkers=[...markers], region=[...selection];
  processing=true;els.noiseProgress.textContent='Анализ шума и обработка…';setStatus('ОБРАБОТКА');refresh();
  try{
    const result=await suppressNoise(original,region[0],region[1],strength,p=>{els.noiseProgress.textContent=`Обработка: ${p}%`});
    undoBuffer={audio:original,markers:originalMarkers};buffer=result;playbackPosition=0;selection=null;
    els.noiseProgress.textContent='Готово. Сравните результат с исходной записью; для возврата нажмите «Отменить».';
    setStatus('ОБРАБОТКА ЗАВЕРШЕНА');notify('Шумоподавление готово. Прослушайте результат.');
  }catch(e){els.noiseProgress.textContent='Обработка не выполнена. Исходная запись не изменена.';setStatus('ЗАПИСЬ ГОТОВА');notify('Не удалось обработать запись: '+e.message)}
  finally{processing=false;refresh()}
};
