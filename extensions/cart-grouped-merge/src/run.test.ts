import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {run} from './run';
const variant=(id:string)=>`gid://shopify/ProductVariant/${id}`;
const product=(id:string)=>`gid://shopify/Product/${id}`;
const set='set-test-12345678';
const count=(quantity:number)=>({type:'number_integer',jsonValue:quantity});
const refs=(ids:string[])=>({type:'list.product_reference',jsonValue:ids.map(product)});
function parent(changes:Record<string,unknown>={}){return {id:'parent-line',quantity:1,parentMarker:{value:'true'},setId:{value:set},bundleId:{value:set},parentVariantId:null,cost:{amountPerQuantity:{amount:'50.00'}},sellingPlanAllocation:null,merchandise:{__typename:'ProductVariant',id:variant('1'),product:{id:product('100'),block1:refs(['2','20']),block2:refs(['3','30']),block3:refs(['4','40']),block1Count:count(1),block2Count:count(1),block3Count:count(1)}},...changes};}
function child(id:string,changes:Record<string,unknown>={}){return {id:'line-'+id,quantity:1,parentMarker:null,setId:{value:set},bundleId:{value:set},parentVariantId:{value:'1'},sellingPlanAllocation:null,merchandise:{__typename:'ProductVariant',id:variant(id),product:{id:product(id)}},...changes};}
function input(lines:unknown[]){return {cartTransform:{testConfiguration:{jsonValue:{testEnabled:true}}},cart:{testFlag:{value:'true'},lines}};}
function execute(lines:unknown[]){return run(input(lines) as Parameters<typeof run>[0]);}
const zero=(id:string)=>({lineUpdate:{cartLineId:'line-'+id,price:{adjustment:{fixedPricePerUnit:{amount:'0.00'}}}}});
const selections=()=>[child('2'),child('3'),child('4')];
const expected={operations:[zero('2'),zero('3'),zero('4')]};
function withBlocks(block1:unknown,block2:unknown=refs(['3']),block3:unknown=refs(['4'])){const p=parent();p.merchandise.product={...p.merchandise.product,block1,block2,block3} as typeof p.merchandise.product;return p;}

describe('trusted parent block selection pricing',()=>{
 it('leaves an empty or ordinary cart unchanged',()=>{expect(execute([])).toEqual({operations:[]});expect(execute([child('2',{setId:null,bundleId:null,parentVariantId:null})])).toEqual({operations:[]});});
 it('prices one allowed product per block at zero and leaves the paid parent unchanged',()=>expect(execute([parent(),...selections()])).toEqual(expected));
 it('rejects an arbitrary product despite correct bundle properties',()=>expect(execute([parent(),child('999'),child('3'),child('4')])).toEqual({operations:[]}));
 it('uses Shopify product identity and permits variants of an allowed product',()=>expect(execute([parent(),child('222',{merchandise:{__typename:'ProductVariant',id:variant('222'),product:{id:product('2')}}}),child('3'),child('4')])).toEqual({operations:[zero('222'),zero('3'),zero('4')]}));
 it('rejects a parent with no trusted product lists',()=>expect(execute([parent({merchandise:{__typename:'ProductVariant',id:variant('1'),product:{id:product('100')}}}),...selections()])).toEqual({operations:[]}));
 it.each([null,refs([]),{type:'json',jsonValue:[product('2')]},{type:'list.product_reference',jsonValue:'["2"]'},{type:'list.product_reference',jsonValue:['invalid']},{type:'list.product_reference',jsonValue:[variant('2')]}])('rejects missing/empty/malformed or wrong-type blocks %#',block=>expect(execute([withBlocks(block),...selections()])).toEqual({operations:[]}));
 it('rejects partial or extra selections as a whole set',()=>{expect(execute([parent(),child('2'),child('3')])).toEqual({operations:[]});expect(execute([parent(),...selections(),child('20')])).toEqual({operations:[]});});
 it('requires one choice per block rather than union membership',()=>expect(execute([parent(),child('2'),child('20'),child('4')])).toEqual({operations:[]}));
 it('finds a valid assignment when lists overlap',()=>expect(execute([withBlocks(refs(['2','3']),refs(['2']),refs(['4'])),...selections()])).toEqual(expected));
 it('supports the same variant selected in multiple blocks and merged into one line',()=>expect(execute([withBlocks(refs(['2']),refs(['2']),refs(['2'])),child('2',{quantity:3})])).toEqual({operations:[zero('2')]}));
 it('scales quantities with the parent, including merged picks',()=>{expect(execute([parent({quantity:2}),...selections().map(c=>({...c,quantity:2}))])).toEqual(expected);const p=withBlocks(refs(['2']),refs(['2']),refs(['2']));p.quantity=2;expect(execute([p,child('2',{quantity:6})])).toEqual({operations:[zero('2')]});});
 it('rejects quantities not divisible by the parent quantity',()=>expect(execute([parent({quantity:2}),...selections()])).toEqual({operations:[]}));
 it.each([0,-1,1.5])('rejects invalid parent quantity %s',quantity=>expect(execute([parent({quantity}),...selections()])).toEqual({operations:[]}));
 it.each(['0.00','-1','invalid'])('requires a paid parent (%s)',amount=>expect(execute([parent({cost:{amountPerQuantity:{amount}}}),...selections()])).toEqual({operations:[]}));
 it('rejects absent or duplicate parents, including three duplicates',()=>{expect(execute(selections())).toEqual({operations:[]});expect(execute([parent(),parent(),...selections()])).toEqual({operations:[]});expect(execute([parent(),parent(),parent(),...selections()])).toEqual({operations:[]});});
 it.each([{parentVariantId:{value:'999'}},{bundleId:{value:'different'}},{parentMarker:{value:'true'}},{quantity:0},{merchandise:{__typename:'CustomProduct'}}])('rejects a malformed member atomically %#',changes=>expect(execute([parent(),child('2',changes),child('3'),child('4')])).toEqual({operations:[]}));
 it('rejects malformed set IDs',()=>expect(execute([parent({setId:{value:'bad'},bundleId:{value:'bad'}}),...selections().map(c=>({...c,setId:{value:'bad'},bundleId:{value:'bad'}}))])).toEqual({operations:[]}));
 it('never makes another variant of the parent product free',()=>expect(execute([withBlocks(refs(['100'])),child('2',{merchandise:{__typename:'ProductVariant',id:variant('2'),product:{id:product('100')}}}),child('3'),child('4')])).toEqual({operations:[]}));
 it('rejects subscription parents or children',()=>{expect(execute([parent({sellingPlanAllocation:{sellingPlan:{id:'plan'}}}),...selections()])).toEqual({operations:[]});expect(execute([parent(),child('2',{sellingPlanAllocation:{sellingPlan:{id:'plan'}}}),child('3'),child('4')])).toEqual({operations:[]});});
 it('validates each parent against its own lists and isolates invalid sets',()=>{const p=withBlocks(refs(['20']),refs(['30']),refs(['40']));p.id='second-parent';p.setId={value:'set-second-12345678'};p.bundleId={value:'set-second-12345678'};expect(execute([parent(),...selections(),p,...selections().map(c=>({...c,id:c.id+'-second',setId:p.setId,bundleId:p.bundleId}))])).toEqual(expected);});
 it('rejects children linked to another set',()=>expect(execute([parent(),...selections().map(c=>({...c,setId:{value:'set-different-12345678'},bundleId:{value:'set-different-12345678'}}))])).toEqual({operations:[]}));
 it('fails closed above the line limit',()=>expect(execute([parent(),...Array.from({length:50},(_,i)=>child(String(i+2)))])).toEqual({operations:[]}));
});


describe('default-off test rollout',()=>{
 const lines=()=>[parent(),...selections()];
 it('does nothing without trusted configuration even when the cart opts in',()=>expect(run({cart:{testFlag:{value:'true'},lines:lines()}} as never)).toEqual({operations:[]}));
 it.each([null,{}, {testEnabled:false},{testEnabled:'true'},true,'true'])('rejects missing, disabled or malformed configuration %#',jsonValue=>expect(run({...input(lines()),cartTransform:{testConfiguration:{jsonValue}}} as never)).toEqual({operations:[]}));
 it.each([null,{value:'false'},{value:'TRUE'},{value:'1'}])('leaves ordinary and non-opted-in carts unchanged %#',testFlag=>expect(run({...input(lines()),cart:{lines:lines(),testFlag}} as never)).toEqual({operations:[]}));
 it('processes only an opted-in cart when the app-owned switch is enabled',()=>expect(execute(lines())).toEqual(expected));
 it('keeps authorization checks active for opted-in carts',()=>expect(execute([parent(),child('999'),child('3'),child('4')])).toEqual({operations:[]}));
});


// Project raw storefront properties using the actual input query bindings, so
// tests catch accidentally querying the legacy keys instead of test-only keys.
function executeProperties(lines: Array<{line: ReturnType<typeof parent> | ReturnType<typeof child>; properties: Record<string,string>}>) {
 const query=readFileSync(new URL('./run.graphql',import.meta.url),'utf8');
 const bindings=[...query.matchAll(/(\w+): attribute\(key: "([^"]+)"\)/g)];
 const projected=lines.map(({line,properties})=>{
  const result:Record<string,unknown>={...line};
  for(const [,alias,key] of bindings) result[alias]=key in properties?{value:properties[key]}:null;
  return result;
 });
 return execute(projected);
}
const testProps=(isParent=false)=>isParent?{_ftr_test_set:set,_ftr_test_parent:'true'}:{_ftr_test_set:set,_ftr_test_parent_variant_id:'1'};
const legacyProps=(isParent=false)=>isParent?{_set:set,_parent:'true',_bundleId:set}:{_set:set,_parent_product_id:'1',_bundleId:set};
const rawTestSet=()=>[parent(),...selections()].map((line,i)=>({line,properties:testProps(i===0)}));

describe('isolated test property contract',()=>{
 it('prices test-only properties without requiring a redundant bundle ID',()=>expect(executeProperties(rawTestSet())).toEqual(expected));
 it('ignores legacy-only lines even when the test cart switch is enabled',()=>expect(executeProperties([parent(),...selections()].map((line,i)=>({line,properties:legacyProps(i===0)})))).toEqual({operations:[]}));
 it('keeps legacy and test sets separate even with the same set value',()=>{
  const legacy=[parent(),...selections()].map((line,i)=>({line:{...line,id:line.id+'-legacy'},properties:legacyProps(i===0)}));
  expect(executeProperties([...rawTestSet(),...legacy])).toEqual(expected);
 });
 it.each(['_set','_parent','_parent_product_id','_bundleId'])('rejects mixed test and legacy keys atomically (%s)',key=>{
  const lines=rawTestSet();lines[1].properties={...lines[1].properties,[key]:key==='_parent'?'true':set};
  expect(executeProperties(lines)).toEqual({operations:[]});
 });
 it('rejects a mismatched optional test bundle ID',()=>{
  const lines=rawTestSet();lines[1].properties={...lines[1].properties,_ftr_test_bundle_id:'set-other-12345678'};
  expect(executeProperties(lines)).toEqual({operations:[]});
 });
 it('rejects four children when the trusted counts authorize only three',()=>{
  const lines=rawTestSet();lines.push({line:child('20'),properties:testProps()});
  expect(executeProperties(lines)).toEqual({operations:[]});
 });
});


function withRules(changes:Record<string,unknown>){
 const p=parent();p.merchandise.product={...p.merchandise.product,...changes};return p;
}
describe('theme-configured block quantities',()=>{
 it('supports a four-child bundle with two picks from block one',()=>expect(execute([
  withRules({block1Count:count(2)}),child('2'),child('20'),child('3'),child('4')
 ])).toEqual({operations:[zero('2'),zero('20'),zero('3'),zero('4')]}));
 it('supports the fourth product block',()=>expect(execute([
  withRules({block4:refs(['5']),block4Count:count(1)}),...selections(),child('5')
 ])).toEqual({operations:[zero('2'),zero('3'),zero('4'),zero('5')]}));
 it('permits disabled and missing blocks but requires at least one active block',()=>{
  expect(execute([withRules({block2:null,block2Count:count(0),block3:null,block3Count:null}),child('2')])).toEqual({operations:[zero('2')]});
  expect(execute([withRules({block1Count:count(0),block2Count:count(0),block3Count:count(0)})])).toEqual({operations:[]});
 });
 it('rejects active blocks with missing product authorization',()=>expect(execute([
  withRules({block4Count:count(1)}),...selections(),child('5')
 ])).toEqual({operations:[]}));
 it.each([{type:'number_integer',jsonValue:-1},{type:'number_integer',jsonValue:1.5},{type:'number_integer',jsonValue:'2'},{type:'json',jsonValue:2},{type:'number_integer',jsonValue:51}])('rejects malformed counts %#',block1Count=>expect(execute([withRules({block1Count}),...selections()])).toEqual({operations:[]}));
 it('rejects missing counts rather than guessing one choice per block',()=>expect(execute([
  withRules({block1Count:null,block2Count:null,block3Count:null}),...selections()
 ])).toEqual({operations:[]}));
 it('requires the correct per-block allocation despite correct total count',()=>expect(execute([
  withRules({block1Count:count(2)}),child('2'),child('3',{quantity:2}),child('4')
 ])).toEqual({operations:[]}));
 it('handles overlapping lists with larger capacities without greedy assignment',()=>expect(execute([
  withRules({block1:refs(['2','3']),block1Count:count(2),block2:refs(['2']),block2Count:count(1),block3Count:count(0)}),child('2'),child('3',{quantity:2})
 ])).toEqual({operations:[zero('2'),zero('3')]}));
 it('scales variable counts by parent quantity, including merged identical picks',()=>expect(execute([
  {...withRules({block1Count:count(2)}),quantity:2},child('2',{quantity:4}),child('3',{quantity:2}),child('4',{quantity:2})
 ])).toEqual(expected));
 it('handles a large repeated selection within the bounded quantity limit',()=>expect(execute([
  withRules({block1Count:count(48)}),child('2',{quantity:48}),child('3'),child('4')
 ])).toEqual(expected));
});
