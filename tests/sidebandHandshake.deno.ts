// Run explicitly with Deno; all network traffic is restricted to a loopback mock server.
import assert from 'node:assert/strict'
// @deno-types="npm:@types/ws@8.18.1"
import WebSocket, { WebSocketServer } from 'npm:ws@8.18.3'
import { authenticatedSidebandSocket } from '../supabase/functions/ai-practice/sidebandSocket.ts'
import { supervisor } from '../supabase/functions/ai-practice/supervisor.ts'

Deno.test('server sideband sends Authorization and supervises a local mock session',async()=>{
 const server=new WebSocketServer({host:'127.0.0.1',port:0})
 await new Promise<void>(resolve=>server.once('listening',resolve))
 const address=server.address();assert(address&&typeof address==='object')
 let authorization:string|undefined,command:unknown,closedSeconds:number|null=null,failed=false
 server.on('connection',(socket,request)=>{
  authorization=request.headers.authorization
  socket.on('message',data=>{
   command=JSON.parse(String(data))
   socket.send(JSON.stringify({type:'session.closed',usage:{seconds:1}}))
  })
 })
 let kept:Promise<void>=Promise.resolve()
 const supervise=supervisor(id=>authenticatedSidebandSocket(id,'local-test-key',(url,options)=>{
  assert.equal(url,'wss://api.openai.com/v1/live/sessions/live_mock/attach')
  return new WebSocket(`ws://127.0.0.1:${address.port}/attach`,options)
 }),task=>{kept=task})
 try{
  await supervise('live_mock',Date.now()+5000,async seconds=>{closedSeconds=seconds},async()=>{failed=true})
  await kept
  assert.equal(authorization,'Bearer local-test-key')
  assert.equal((command as {type:string}).type,'session.instructions.append')
  assert.equal(closedSeconds,1);assert.equal(failed,false)
 }finally{
  for(const socket of server.clients)socket.terminate()
  await new Promise<void>(resolve=>server.close(()=>resolve()))
 }
})
