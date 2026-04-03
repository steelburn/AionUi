declare global {
  interface Window {
    petAPI: {
      onStateChange: (cb: (state: string) => void) => void;
      onEyeMove: (cb: (data: { eyeDx: number; eyeDy: number; bodyDx: number; bodyRotate: number }) => void) => void;
      onResize: (cb: (size: number) => void) => void;
    };
  }
}

const LOAD_TIMEOUT = 3000;
let currentObject: HTMLObjectElement | null = document.getElementById('pet') as HTMLObjectElement;

function loadSvg(svgPath: string): void {
  const newObj = document.createElement('object');
  newObj.type = 'image/svg+xml';
  newObj.id = 'pet';
  newObj.style.width = '100%';
  newObj.style.height = '100%';
  newObj.data = svgPath;

  let loaded = false;
  const timeout = setTimeout(() => {
    if (!loaded) {
      newObj.remove();
    }
  }, LOAD_TIMEOUT);

  newObj.addEventListener('load', () => {
    loaded = true;
    clearTimeout(timeout);
    if (currentObject) currentObject.remove();
    currentObject = newObj;
  });

  document.body.appendChild(newObj);
}

window.petAPI.onStateChange((state: string) => {
  loadSvg(`../../public/pet-states/${state}.svg`);
});

window.petAPI.onEyeMove(({ eyeDx, eyeDy, bodyDx, bodyRotate }) => {
  if (!currentObject) return;
  const doc = currentObject.contentDocument;
  if (!doc) return;

  const pupil = doc.querySelector('.idle-pupil');
  const track = doc.querySelector('.idle-track');
  if (pupil) pupil.setAttribute('transform', `translate(${eyeDx} ${eyeDy})`);
  if (track) track.setAttribute('transform', `translate(${bodyDx} 0) rotate(${bodyRotate} 11 12)`);
});

export {};
