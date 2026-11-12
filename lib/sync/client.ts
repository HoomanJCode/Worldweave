import { createClient, type RealtimeChannel, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { Shape, WorldMap } from "../world/model";

export type MemberRole = "owner" | "editor" | "viewer";
export type Participant = { userId:string; displayName:string; color:string; cursor?:{x:number;y:number}; state:"connected"|"away"; character?:{x:number;y:number;enabled:boolean} };
export type WorkspaceSummary={id:string;name:string;role:MemberRole;displayName:string;color:string};
export type SyncConfig = { url:string; anonKey:string };

export function readSyncConfig(): SyncConfig | null {
  const url=import.meta.env.VITE_SUPABASE_URL?.trim(),anonKey=import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  return url&&anonKey?{url,anonKey}:null;
}

export function makeSupabaseClient(config:SyncConfig):SupabaseClient {
  return createClient(config.url,config.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true},realtime:{params:{eventsPerSecond:20}}});
}

export async function getOrCreateAnonymousUser(client:SupabaseClient):Promise<User> {
  const {data:{user}}=await client.auth.getUser();if(user)return user;
  const {data,error}=await client.auth.signInAnonymously();if(error||!data.user)throw error??new Error("Could not start an anonymous session.");return data.user;
}

export async function createWorkspace(client:SupabaseClient,name:string,displayName:string,color:string):Promise<string> {
  const {data,error}=await client.rpc("create_workspace",{p_name:name,p_display_name:displayName,p_cursor_color:color});if(error)throw error;return data as string;
}

export async function listMyWorkspaces(client:SupabaseClient):Promise<WorkspaceSummary[]> {
  const {data,error}=await client.from("workspace_members").select("workspace_id,role,display_name,cursor_color,workspaces!inner(name)").order("joined_at");if(error)throw error;
  return (data??[]).map(row=>({id:row.workspace_id,role:row.role as MemberRole,displayName:row.display_name,color:row.cursor_color,name:(row.workspaces as unknown as {name:string}).name}));
}

export async function listWorkspaceMembers(client:SupabaseClient,workspaceId:string):Promise<Participant[]> {
  const {data,error}=await client.from("workspace_members").select("user_id,display_name,cursor_color").eq("workspace_id",workspaceId);if(error)throw error;
  return (data??[]).map(row=>({userId:row.user_id,displayName:row.display_name,color:row.cursor_color,state:"away"}));
}

export async function listWorkspaceMaps(client:SupabaseClient,workspaceId:string):Promise<Array<{id:string;name:string}>> {
  const {data,error}=await client.from("maps").select("id,name").eq("workspace_id",workspaceId).order("updated_at",{ascending:false});if(error)throw error;return data??[];
}

export function watchWorkspaceCommands(client:SupabaseClient,workspaceId:string,onEvent:(event:{mapId:string;shapeId:string|null;revision:number|null;operation:string})=>void):RealtimeChannel {
  const channel=client.channel(`worldweave:commands:${workspaceId}`).on("postgres_changes",{event:"INSERT",schema:"public",table:"command_events",filter:`workspace_id=eq.${workspaceId}`},payload=>{
    const row=payload.new as {map_id:string;object_id:string|null;object_revision:number|null;operation:string};
    onEvent({mapId:row.map_id,shapeId:row.object_id,revision:row.object_revision===null?null:Number(row.object_revision),operation:row.operation});
  }).subscribe();return channel;
}

export async function acceptInvite(client:SupabaseClient,token:string,displayName:string,color:string):Promise<{workspace_id:string;role:MemberRole}> {
  const {data,error}=await client.rpc("accept_workspace_invite",{p_token:token,p_display_name:displayName,p_cursor_color:color});if(error)throw error;
  const row=Array.isArray(data)?data[0]:data;if(!row)throw new Error("Invite returned no workspace.");return row as {workspace_id:string;role:MemberRole};
}

export async function createInvite(client:SupabaseClient,workspaceId:string,role:"editor"|"viewer"="editor",ttlSeconds=604800,maxUses=10):Promise<{invite_id:string;token:string;expires_at:string}> {
  const {data,error}=await client.rpc("create_workspace_invite",{p_workspace:workspaceId,p_role:role,p_ttl_seconds:ttlSeconds,p_max_uses:maxUses});if(error)throw error;
  const row=Array.isArray(data)?data[0]:data;if(!row)throw new Error("Invite creation returned no token.");return row as {invite_id:string;token:string;expires_at:string};
}

export async function revokeInvite(client:SupabaseClient,inviteId:string):Promise<boolean> {const {data,error}=await client.rpc("revoke_workspace_invite",{p_invite:inviteId});if(error)throw error;return Boolean(data);}

export async function createSharedMap(client:SupabaseClient,workspaceId:string,map:Pick<WorldMap,"name"|"width"|"height"|"grid"|"snap">):Promise<string> {
  const {data,error}=await client.from("maps").insert({workspace_id:workspaceId,...map}).select("id").single();if(error)throw error;return data.id as string;
}

export async function loadSharedMap(client:SupabaseClient,mapId:string):Promise<WorldMap> {
  const [{data:row,error:mapError},{data:rows,error:shapeError}]=await Promise.all([
    client.from("maps").select("id,name,width,height,grid,snap,updated_at").eq("id",mapId).single(),
    client.from("map_shapes").select("id,name,kind,geometry,style,collision,collision_thickness,visible,locked,parent_id,revision,created_at").eq("map_id",mapId).order("created_at"),
  ]);
  if(mapError)throw mapError;if(shapeError)throw shapeError;
  const shapes=(rows??[]).map(row=>({id:row.id,name:row.name,kind:row.kind as Shape["kind"],points:(row.geometry as {points:Shape["points"]}).points,closed:Boolean((row.geometry as {closed?:boolean}).closed),style:row.style as Shape["style"],collision:row.collision as Shape["collision"],collisionThickness:Number(row.collision_thickness),visible:row.visible,locked:row.locked,revision:Number(row.revision),createdAt:new Date(row.created_at).getTime(),parentId:row.parent_id}));
  return {formatVersion:1,id:row.id,name:row.name,width:row.width,height:row.height,grid:row.grid,snap:row.snap,shapes,updatedAt:new Date(row.updated_at).getTime()};
}

export async function applySharedCommand(client:SupabaseClient,mapId:string,operation:"create"|"update"|"delete",shape:Shape,expectedRevision:number,payload:Record<string,unknown>={}):Promise<{revision:number;duplicate:boolean}> {
  const mapIdToWorkspace=await client.from("maps").select("workspace_id").eq("id",mapId).single();if(mapIdToWorkspace.error)throw mapIdToWorkspace.error;
  const data=operation==="delete"?{}:{id:shape.id,name:shape.name,kind:shape.kind,geometry:{points:shape.points,closed:shape.closed},style:shape.style,collision:shape.collision,collision_thickness:shape.collisionThickness,visible:shape.visible,locked:shape.locked,parent_id:shape.parentId,...payload};
  const {data:result,error}=await client.rpc("apply_shape_command",{p_command_id:crypto.randomUUID(),p_map_id:mapId,p_shape_id:shape.id,p_expected_revision:expectedRevision,p_operation:operation,p_data:data});if(error)throw error;
  const response=result as {ok:boolean;duplicate?:boolean;conflict?:boolean;expected?:number;actual?:number;revision?:number};
  if(response.conflict)throw new Error(`Revision conflict for ${shape.name}: expected ${response.expected}, latest is ${response.actual}.`);if(!response.ok)throw new Error("The edit was not accepted.");return {revision:response.revision??expectedRevision,duplicate:Boolean(response.duplicate)};
}

export function joinWorkspaceChannel(client:SupabaseClient,workspaceId:string,identity:Participant,onParticipants:(users:Participant[])=>void,onCursor:(userId:string,cursor:Participant["cursor"])=>void,onCharacter:(userId:string,character:Participant["character"])=>void,onStatus:(status:"connecting"|"connected"|"disconnected")=>void):{channel:RealtimeChannel;sendCursor:(cursor:{x:number;y:number})=>void;sendCharacter:(character:{x:number;y:number;enabled:boolean})=>void;leave:()=>Promise<void>} {
  const channel=client.channel(`worldweave:${workspaceId}`,{config:{presence:{key:identity.userId},broadcast:{self:false}}});
  channel.on("presence",{event:"sync"},()=>{const state=channel.presenceState<Participant>();const users=Object.values(state).flat().map(item=>({...item,state:"connected" as const}));onParticipants(users)});
  channel.on("broadcast",{event:"cursor"},({payload})=>{if(payload?.userId&&payload.userId!==identity.userId)onCursor(payload.userId,payload.cursor)});
  channel.on("broadcast",{event:"character"},({payload})=>{if(payload?.userId&&payload.userId!==identity.userId)onCharacter(payload.userId,payload.character)});
  channel.subscribe(async status=>{if(status==="SUBSCRIBED"){onStatus("connected");await channel.track({...identity,cursor:undefined});}else if(status==="CHANNEL_ERROR"||status==="TIMED_OUT")onStatus("disconnected");else if(status==="CLOSED")onStatus("disconnected");else onStatus("connecting")});
  let lastCursorAt=0;const sendCursor=(cursor:{x:number;y:number})=>{const now=Date.now();if(now-lastCursorAt<33)return;lastCursorAt=now;void channel.send({type:"broadcast",event:"cursor",payload:{userId:identity.userId,cursor}})};
  const sendCharacter=(character:{x:number;y:number;enabled:boolean})=>{void channel.send({type:"broadcast",event:"character",payload:{userId:identity.userId,character}})};
  return {channel,sendCursor,sendCharacter,leave:async()=>{await client.removeChannel(channel)}};
}
