"use client";
import {useSavedBooks} from "@/lib/books/use-saved-books";
export function BookSaveButton({bookId,japanese=true}:{bookId:string;japanese?:boolean}){
 const saved=useSavedBooks(),active=saved.ids.includes(bookId);
 return <span className="book-save"><button type="button" className="button" disabled={!saved.ready} aria-pressed={active} onClick={()=>saved.save(bookId,!active)}>{active?(japanese?"保存済み・解除":"Saved · Remove"):(japanese?"本を保存":"Save book")}</button>{saved.error?<small role="status">{japanese?"保存済みの本を読み込み・更新できませんでした。もう一度お試しください。":"Could not read or update saved books. Please try again."}</small>:null}</span>;
}
