// Reads one file out of a release ZIP without a dependency or an external unzip.
import {inflateRawSync} from 'node:zlib';
export function readZipEntry(bytes,name){
 let end=bytes.length-22;
 while(end>=0&&bytes.readUInt32LE(end)!==0x06054b50)end--;
 if(end<0)throw Error('Not a ZIP archive');
 let at=bytes.readUInt32LE(end+16);
 for(let i=bytes.readUInt16LE(end+10);i>0;i--){
  if(bytes.readUInt32LE(at)!==0x02014b50)throw Error('Corrupt ZIP directory');
  const method=bytes.readUInt16LE(at+10),size=bytes.readUInt32LE(at+20),nameLength=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),local=bytes.readUInt32LE(at+42);
  if(bytes.toString('utf8',at+46,at+46+nameLength)===name){
   const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28),data=bytes.subarray(start,start+size);
   if(method===0)return Buffer.from(data);
   if(method===8)return inflateRawSync(data);
   throw Error('Unsupported ZIP compression: '+name);
  }
  at+=46+nameLength+extra+comment;
 }
 throw Error('Artifact has no '+name);
}
export function zipEntryNames(bytes){
 let end=bytes.length-22;
 while(end>=0&&bytes.readUInt32LE(end)!==0x06054b50)end--;
 if(end<0)throw Error('Not a ZIP archive');
 const names=[];let at=bytes.readUInt32LE(end+16);
 for(let i=bytes.readUInt16LE(end+10);i>0;i--){
  if(bytes.readUInt32LE(at)!==0x02014b50)throw Error('Corrupt ZIP directory');
  const nameLength=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32);
  names.push(bytes.toString('utf8',at+46,at+46+nameLength));at+=46+nameLength+extra+comment;
 }
 return names;
}
