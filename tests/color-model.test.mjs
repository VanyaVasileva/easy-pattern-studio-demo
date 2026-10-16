import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexToRgb, rgbToHex, rgbToHsv, hsvToRgb } from '../app/color-model.ts';
test('primary colors, white, and black have exact HSV values', () => {
  for (const [hex,hsv] of [['#ff0000',{h:0,s:1,v:1}],['#00ff00',{h:120,s:1,v:1}],['#0000ff',{h:240,s:1,v:1}],['#ffffff',{h:0,s:0,v:1}],['#000000',{h:0,s:0,v:0}]]) {
    assert.deepEqual(rgbToHsv(hexToRgb(hex)),hsv); assert.equal(rgbToHex(hsvToRgb(hsv)),hex);
  }
});
test('exact RGB values survive HSV conversion for grays and varied colors', () => {
  for(let n=0;n<256;n++) {const rgb={r:n,g:n,b:n};assert.deepEqual(hsvToRgb(rgbToHsv(rgb)),rgb);}
  let seed=12345;
  for(let n=0;n<2000;n++) {seed=(Math.imul(seed,1664525)+1013904223)>>>0;const rgb={r:seed&255,g:(seed>>>8)&255,b:(seed>>>16)&255};assert.deepEqual(hsvToRgb(rgbToHsv(rgb)),rgb);}
});
test('hue wraps and RGB channels are clamped', () => {
  assert.deepEqual(hsvToRgb({h:360,s:1,v:1}),{r:255,g:0,b:0});
  assert.deepEqual(hsvToRgb({h:-120,s:1,v:1}),{r:0,g:0,b:255});
  assert.equal(rgbToHex({r:-3,g:300,b:12.6}),'#00ff0d');
});
