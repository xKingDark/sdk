import { fstat, writeFile } from "fs";
import { FuncDef, GoBuilder, GoBuilderOptions } from "./go/builder";
import { Func, Kind, Struct, Interface, TypeDef } from "./go/types";

const options: GoBuilderOptions = {
  name: "My First Go Project",
};

const builder = new GoBuilder(options);

for (let i = 0; i < 1_000; i++) {
  const packageNode = builder.CreatePackageNode("main");
  const packageId = builder.SetNode(packageNode);

  const fmtNode = builder.CreateImportValueNode("fmt");
  const fmt = builder.SetNode(fmtNode);

  const strconvNode = builder.CreateImportValueNode("strconv");
  const strconv = builder.SetNode(strconvNode);

  const importNode = builder.CreateImportNode(fmt, strconv);
  const importId = builder.SetNode(importNode);

  builder.ConnectNodes(packageId, importId);

  const myFuncType = Func("test");

  const varValueNode = builder.CreateVarValueNode(
    "test",
    {
      type: Kind.INT,
      id: "",
    },
    "67"
  );
  const varValueId = builder.SetNode(varValueNode);
  const varNode = builder.CreateVarNode(varValueId);
  const varId = builder.SetNode(varNode);

  /* const myFunc: FuncDef = {
    type: myFuncType,
    body: [varId],
  };

  const funcNode = builder.CreateFuncNode(myFunc);
  const funcId = builder.SetNode(funcNode); */

  builder.ConnectNodes(importId, varId);
}

const myStruct = new Struct()
  .Name("myStruct")
  .Field("Hello", Kind.STRING, 'json:"hello"')
  .AsDefinition();

const test: Kind = Kind.ARRAY;

const myInterface: TypeDef = new Interface().Name("myInterface").AsDefinition();

function formatBytes(size: number) {
  if (size === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(size) / Math.log(k));

  return `${(size / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

{
  (async () => {
    const now = Date.now();
    const output = builder.Export();
    console.log(`Build time: ${Date.now() - now}ms`);
    console.log(output);
    console.log(`size: ${formatBytes(output.length)}`);
    let { signal } = new AbortController();
    writeFile("nodes.opt", output, { signal }, (err) => {
      if (!err) return;
      console.error(err);
    });
  })();
}
