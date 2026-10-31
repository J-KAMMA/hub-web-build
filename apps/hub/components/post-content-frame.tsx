import React, { type ReactNode } from "react";

type PostContentFrameProps = {
  children: ReactNode;
  className?: string;
};

type PostAuthorRowProps = {
  name: ReactNode;
  handle?: ReactNode;
  badges?: ReactNode;
  meta?: ReactNode;
  contextActions?: ReactNode;
  menu?: ReactNode;
  className?: string;
};

export function PostContentFrame({ children, className = "" }: PostContentFrameProps) {
  return <div className={`tweet__body${className ? ` ${className}` : ""}`}>{children}</div>;
}

export function PostAuthorRow({
  name,
  handle,
  badges,
  meta,
  contextActions,
  menu,
  className = "",
}: PostAuthorRowProps) {
  const tools = contextActions || menu;
  return (
    <header className={`tweet__header${className ? ` ${className}` : ""}`}>
      <div className="tweet__identity">
        {name}
        {handle}
        {badges}
        {meta}
      </div>
      {tools ? (
        <div className="tweet__header-tools">
          {contextActions}
          {menu}
        </div>
      ) : null}
    </header>
  );
}
