// Fictional roster used by the public test. A slot is a costume and a display name.
const classes = [
  ['3A','陳樂晴','何俊熙','李心悠','梁梓謙','吳芷晴'],
  ['3B','黃子澄','林曉嵐','周穎希','許諾言','郭嘉欣'],
  ['4A','葉芷澄','鄭允行','方沛恩','劉晞彤','蔡卓衡'],
  ['4B','馮欣妍','潘柏翹','伍思澄','余凱晴','謝朗軒'],
  ['5A','羅芷柔','胡子淳','馬曉彤','高晉希','曹悅童'],
  ['5B','黎俊朗','曾愷琳','蘇可兒','徐柏然','鍾雨桐']
];
export const students = Array.from({length:30}, (_,slot) => {
  const group = classes[slot % classes.length];
  return {slot, className:group[0], name:group[1+Math.floor(slot/classes.length)], appearance:slot};
});
