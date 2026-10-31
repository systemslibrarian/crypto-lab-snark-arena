import {expect,it} from 'vitest';
import {classifySemanticOutcome as classify} from './semantic-outcomes';
const base={domainValid:true,expected:7,observed:7,accepted:true,honestUnmodifiedProver:false,validWitness:false,malformedProof:false,crashed:false};
it('requires output mismatch and acceptance for soundness evidence',()=>{
 expect(classify(base)).not.toContain('Soundness failure');
 expect(classify({...base,observed:8})).toContain('Soundness failure');
 expect(classify({...base,observed:8,accepted:false})).not.toContain('Soundness failure');
});
it('requires an honest valid prover for completeness evidence',()=>{
 expect(classify({...base,accepted:false,honestUnmodifiedProver:true,validWitness:true})).toContain('Completeness failure');
 expect(classify({...base,accepted:false,malformedProof:true})).toContain('Rejection control');
 expect(classify({...base,accepted:false,crashed:true,honestUnmodifiedProver:true,validWitness:true})).toContain('Crash');
 expect(classify({...base,domainValid:false})).toContain('Outside');
});
