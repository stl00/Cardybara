import {BUILD_ID} from './build-info.js';
// Export only wallet observations and task state; never parser settings or keys.
export function exportCollectorState(state,exportedAt=new Date().toISOString()){
 return structuredClone({schema:2,version:'1.2.0',exporterBuild:BUILD_ID,runtimeBuild:state.runtimeBuild||null,exportedAt,records:state.records||{},agentRecords:state.agentRecords||[],run:state.run||null,lastBankJobs:state.lastBankJobs||{},revision:state.revision??0});
}
