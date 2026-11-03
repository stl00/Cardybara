// Create an empty local wallet only when none exists; never overwrite account data.
import {copyFile,access} from 'node:fs/promises';
import {constants} from 'node:fs';
const target=new URL('../public/data.json',import.meta.url);
try{await access(target);console.log('Existing local wallet preserved.');}catch{await copyFile(new URL('../public/data.example.json',import.meta.url),target,constants.COPYFILE_EXCL);console.log('Created empty local wallet. Add a card or connect a bank; backup import is optional.');}
