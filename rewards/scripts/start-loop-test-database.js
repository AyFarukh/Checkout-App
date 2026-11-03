import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {MongoMemoryServer} from 'mongodb-memory-server';
// Persistent, loopback-only test DB. Never connects to an existing remote DB.
const path=resolve('.loop-test-db');await mkdir(path,{recursive:true});
const mongo=await MongoMemoryServer.create({instance:{dbPath:path,port:27027,ip:'127.0.0.1',args:['--nounixsocket']}});
console.log('Local test database ready at mongodb://127.0.0.1:27027/freetheroot_loop_test');
console.log('Keep this terminal open. Ctrl+C stops Mongo while preserving the test ledger.');
async function stop(){await mongo.stop({doCleanup:false});process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
