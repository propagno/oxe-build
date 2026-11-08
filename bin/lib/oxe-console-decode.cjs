'use strict';

/**
 * OXB-152: cmd.exe writes its own messages in the OEM code page (cp850 on a pt-BR Windows) even when the command's
 * output is UTF-8: "'.' não é reconhecido" arrived as "'.' n\uFFFDo \uFFFD rec…", hiding the cause. Bytes that are valid
 * UTF-8 stay UTF-8; otherwise they are read as cp850.
 */

const CP850_HIGH = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ";

function decodeConsoleOutput(buf) {
  if (buf == null) return '';
  if (typeof buf === 'string') return buf;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    let out = '';
    for (const byte of buf) out += byte < 0x80 ? String.fromCharCode(byte) : CP850_HIGH[byte - 0x80];
    return out;
  }
}

module.exports = { decodeConsoleOutput };
