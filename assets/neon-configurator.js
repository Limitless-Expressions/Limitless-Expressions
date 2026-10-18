/* Neon-only controls; order serialization continues to use the existing field IDs. */
const NeonConfigurator = (() => {
  const fonts = {
    'Single-Stroke Neon': [
      ['Sacramento', 'Sacramento-Regular.ttf'], ['Hershey Script', null], ['EMS Allure', null]
    ],
    'Double-Stroke Neon': [
      ['Dancing Script Bold', 'DancingScript[wght].ttf', '700'],
      ['Pacifico', 'Pacifico-Regular.ttf'], ['Satisfy', 'Satisfy-Regular.ttf'],
      ['Lobster', 'Lobster-Regular.ttf'], ['Courgette', 'Courgette-Regular.ttf'],
      ['Kaushan Script', 'KaushanScript-Regular.ttf'], ['Yellowtail', 'Yellowtail-Regular.ttf'],
      ['Allura', 'Allura-Regular.ttf']
    ]
  };
  const base = new URL('neon-fonts/', document.currentScript.src);
  const loaded = new Map();
  function field(name) {
    if (name === 'Neon channel style') return `<fieldset class="field full neon-config"><legend>Neon channel style</legend><div class="neon-styles">
      <label><input type="radio" name="neon-style" value="Single-Stroke Neon" checked><strong>Single-Stroke Neon</strong><svg viewBox="0 0 160 65" aria-hidden="true"><path d="M25 50L50 12L75 50M36 34H64M95 12V50H135"/></svg><span>A single neon channel follows the centerline of the lettering.</span></label>
      <label><input type="radio" name="neon-style" value="Double-Stroke Neon"><strong>Double-Stroke Neon</strong><svg viewBox="0 0 160 65" aria-hidden="true"><path d="M20 52L45 10H55L80 52H68L61 39H39L32 52ZM44 30H56L50 19ZM95 10H106V42H138V52H95Z"/></svg><span>Neon follows the letter outlines, creating a double-outline effect.</span></label>
      </div><input type="hidden" id="f_Neon_channel_style" value="Single-Stroke Neon"></fieldset>`;
    if (name === 'Font style') return `<div class="field full neon-config"><label>Choose a font</label><input type="hidden" id="f_Font_style"><div id="neonFonts" class="neon-fonts" role="group" aria-label="Font options"></div><div id="neonFontStatus" role="status"></div><label>Live lettering preview</label><div id="neonPreview" class="neon-preview"></div><p class="neon-help">Preview represents the lettering style. Final neon channel paths may require production adjustments. Single-stroke font previews show lettering, not production-ready centerline paths.</p></div>`;
    if (name === 'Mounting preference') return `<div class="field full neon-config"><label for="f_Mounting_preference">Mounting preference</label><select id="f_Mounting_preference"><option>Integrated Keyhole Wall Mounts (Recommended / Default)</option><option>Wall Mounting Screw Holes</option><option>Wall Standoffs (Request Quote)</option><option>Custom Mounting (Request Quote)</option></select><p class="neon-help">Designed for indoor wall mounting. Final mounting method and hardware requirements depend on sign size, design, and wall surface.</p></div>`;
  }
  function init(form) {
    const style = form.querySelector('#f_Neon_channel_style');
    if (!style) return;
    const selected = form.querySelector('#f_Font_style');
    const list = form.querySelector('#neonFonts');
    const preview = form.querySelector('#neonPreview');
    const status = form.querySelector('#neonFontStatus');
    const text = form.querySelector('#f_Name_text_optional_if_uploading_logo_');
    let generation = 0;
    const updateText = () => {
      const value = text.value.trim() || 'Your Name';
      list.querySelectorAll('.neon-sample').forEach(sample => { sample.textContent = value; });
      if (selected.value) preview.textContent = value;
    };
    const choose = (button, family, weight) => {
      if (selected.disabled) return; // Saved orders remain immutable.
      selected.value = button.dataset.font;
      list.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
      preview.style.fontFamily = family;
      preview.style.fontWeight = weight;
      updateText();
      makeSummary();
    };
    async function renderFonts() {
      const version = ++generation;
      selected.value = '';
      preview.textContent = 'Loading font previews…';
      preview.style.fontFamily = 'inherit';
      list.replaceChildren();
      status.textContent = '';
      const pending = fonts[style.value].map(async ([name, file, weight = '400']) => {
        const button = document.createElement('button');
        button.type = 'button'; button.disabled = true; button.dataset.font = name;
        button.setAttribute('aria-pressed', 'false');
        const title = document.createElement('span'); title.textContent = name;
        const sample = document.createElement('span'); sample.className = 'neon-sample';
        const state = document.createElement('small'); state.textContent = file ? 'Loading…' : 'Unavailable — font asset required';
        button.append(title, sample, state); list.append(button);
        if (!file) return;
        const family = 'LE Neon ' + name;
        try {
          if (!loaded.has(name)) {
            const face = new FontFace(family, `url("${new URL(file, base).href}")`, {weight});
            loaded.set(name, face.load().then(font => { document.fonts.add(font); return font; }).catch(error => { loaded.delete(name); throw error; }));
          }
          await loaded.get(name);
          if (version !== generation || !form.contains(list)) return;
          sample.style.fontFamily = `"${family}"`; sample.style.fontWeight = weight;
          sample.textContent = text.value.trim() || 'Your Name';
          state.textContent = ''; button.disabled = false;
          button.addEventListener('click', () => choose(button, `"${family}"`, weight));
        } catch {
          if (version === generation) state.textContent = 'Unavailable — font could not load';
        }
      });
      makeSummary();
      await Promise.all(pending);
      if (version !== generation || !form.contains(list)) return;
      const first = list.querySelector('button:not(:disabled)');
      if (!selected.value && first) first.click();
      if (!first) preview.textContent = 'No font preview available. Upload a design or describe your font request in Notes.';
      status.textContent = style.value === 'Single-Stroke Neon' ? 'Hershey Script and EMS Allure are unavailable; their font assets are required.' : 'Select a font to preview your text.';
    }
    form.querySelectorAll('input[name="neon-style"]').forEach(radio => radio.addEventListener('change', () => {
      style.value = radio.value; renderFonts();
    }));
    text.addEventListener('input', updateText);
    form.querySelectorAll('input, select, textarea').forEach(control => {
      control.addEventListener('input', makeSummary);
      control.addEventListener('change', makeSummary);
    });
    renderFonts();
  }
  return {field, init};
})();
