"use client";
import {useCallback,useEffect,useState} from "react";
export const SAVED_BOOKS_KEY="hub.books.saved.v1";
const changed="hub:saved-books-changed";
function read():string[]{
 const raw=localStorage.getItem(SAVED_BOOKS_KEY);
 if(raw===null)return [];
 const value:unknown=JSON.parse(raw);
 if(!Array.isArray(value)||value.length>1000||value.some(id=>typeof id!=="string"||!id||id.length>200))throw new Error("Invalid saved books");
 return [...new Set(value)] as string[];
}
export function useSavedBooks(){
 const [ids,setIds]=useState<string[]>([]),[error,setError]=useState(false),[ready,setReady]=useState(false);
 const sync=useCallback(()=>{try{setIds(read());setError(false);}catch{setError(true);}finally{setReady(true);}},[]);
 useEffect(()=>{
  sync();window.addEventListener(changed,sync);window.addEventListener("storage",sync);window.addEventListener("pageshow",sync);
  return()=>{window.removeEventListener(changed,sync);window.removeEventListener("storage",sync);window.removeEventListener("pageshow",sync);};
 },[sync]);
 const save=(id:string,value:boolean)=>{
  try{
   if(!id||id.length>200)throw new Error("Invalid book");
   const current=read(),next=value?[...new Set([...current,id])]:current.filter(item=>item!==id);
   if(next.length>1000)throw new Error("Saved book limit");
   localStorage.setItem(SAVED_BOOKS_KEY,JSON.stringify(next));setIds(next);setError(false);window.dispatchEvent(new Event(changed));return true;
  }catch{setError(true);return false;}
 };
 const retry=()=>window.dispatchEvent(new Event(changed));
 return {ids,error,ready,save,retry};
}
