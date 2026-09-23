/** Server-only adapter: do not depend on runtime-specific native WebSocket header options. */
export type ControlSocket={
 readonly readyState:number
 onopen:(()=>void)|null
 onerror:(()=>void)|null
 onclose:(()=>void)|null
 onmessage:((event:{data:unknown})=>void)|null
 send:(text:string)=>void
 close:()=>void
}
type UpstreamSocket={
 readonly readyState:number
 on:(event:string,listener:(...args:unknown[])=>void)=>unknown
 send:(text:string)=>void
 terminate:()=>void
}
export type SocketOptions={headers:{Authorization:string};handshakeTimeout:number;maxPayload:number;followRedirects:false;perMessageDeflate:false}
export function authenticatedSidebandSocket(id:string,key:string,create:(url:string,options:SocketOptions)=>UpstreamSocket):ControlSocket{
 const upstream=create(`wss://api.openai.com/v1/live/sessions/${encodeURIComponent(id)}/attach`,{
  headers:{Authorization:`Bearer ${key}`},handshakeTimeout:10000,maxPayload:32000,followRedirects:false,perMessageDeflate:false,
 })
 const socket:ControlSocket={
  get readyState(){return upstream.readyState},onopen:null,onerror:null,onclose:null,onmessage:null,
  send:text=>upstream.send(text),close:()=>upstream.terminate(),
 }
 upstream.on('open',()=>socket.onopen?.())
 upstream.on('error',()=>socket.onerror?.())
 upstream.on('close',()=>socket.onclose?.())
 upstream.on('message',(data,isBinary)=>{if(!isBinary)socket.onmessage?.({data:String(data)})})
 return socket
}
