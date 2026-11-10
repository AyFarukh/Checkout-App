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
function execute(lines:unknown[]){return run({cart:{lines}} as Parameters<typeof run>[0]);}
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
 it.each([{parentMarker:{value:'true'}},{quantity:0},{merchandise:{__typename:'CustomProduct'}}])('rejects a malformed member atomically %#',changes=>expect(execute([parent(),child('2',changes),child('3'),child('4')])).toEqual({operations:[]}));
 it('rejects malformed set IDs',()=>expect(execute([parent({setId:{value:'bad'},bundleId:{value:'bad'}}),...selections().map(c=>({...c,setId:{value:'bad'},bundleId:{value:'bad'}}))])).toEqual({operations:[]}));
 it('never makes another variant of the parent product free',()=>expect(execute([withBlocks(refs(['100'])),child('2',{merchandise:{__typename:'ProductVariant',id:variant('2'),product:{id:product('100')}}}),child('3'),child('4')])).toEqual({operations:[]}));
 it('rejects subscription parents or children',()=>{expect(execute([parent({sellingPlanAllocation:{sellingPlan:{id:'plan'}}}),...selections()])).toEqual({operations:[]});expect(execute([parent(),child('2',{sellingPlanAllocation:{sellingPlan:{id:'plan'}}}),child('3'),child('4')])).toEqual({operations:[]});});
 it('validates each parent against its own lists and isolates invalid sets',()=>{const p=withBlocks(refs(['20']),refs(['30']),refs(['40']));p.id='second-parent';p.setId={value:'set-second-12345678'};p.bundleId={value:'set-second-12345678'};expect(execute([parent(),...selections(),p,...selections().map(c=>({...c,id:c.id+'-second',setId:p.setId,bundleId:p.bundleId}))])).toEqual(expected);});
 it('rejects children linked to another set',()=>expect(execute([parent(),...selections().map(c=>({...c,setId:{value:'set-different-12345678'},bundleId:{value:'set-different-12345678'}}))])).toEqual({operations:[]}));
 it('fails closed above the line limit',()=>expect(execute([parent(),...Array.from({length:50},(_,i)=>child(String(i+2)))])).toEqual({operations:[]}));
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



function executeProperties(properties:Record<string,string>[]){
 const query=readFileSync(new URL('./run.graphql',import.meta.url),'utf8');
 const bindings=[...query.matchAll(/(\w+): attribute\(key: "([^"]+)"\)/g)];
 return execute([parent(),...selections()].map((line,index)=>{
  const projected:Record<string,unknown>={...line};
  for(const [,alias,key] of bindings)projected[alias]=key in properties[index]?{value:properties[index][key]}:null;
  return projected;
 }));
}
describe('direct bundle protocol without demo switches',()=>{
 it('prices the __bundle payload without a cart flag or app-owned configuration',()=>expect(executeProperties([
  {__bundle:set,_parent:'true'},
  {__bundle:set,_parent_product_id:'1'},
  {__bundle:set,_parent_product_id:'1'},
  {__bundle:set,_parent_product_id:'1'}
 ])).toEqual(expected));
 it('does not match the old _set protocol',()=>expect(executeProperties([
  {_set:set,_parent:'true'},
  {_set:set,_parent_product_id:'1'},
  {_set:set,_parent_product_id:'1'},
  {_set:set,_parent_product_id:'1'}
 ])).toEqual({operations:[]}));
 it('keeps input cost at or below 30 and query size below 3000 bytes',()=>{
  const query=readFileSync(new URL('./run.graphql',import.meta.url),'utf8');
  const cost=3*[...query.matchAll(/\bmetafield\s*\(/g)].length+(query.match(/\b(id|quantity|amount|value)\b(?!\s*:)/g)||[]).length;
  expect(cost).toBeLessThanOrEqual(30);expect(Buffer.byteLength(query)).toBeLessThanOrEqual(3000);
 });
});
