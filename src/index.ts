import { fstat, writeFile } from "fs";
import { FuncDef, GoBuilder, GoBuilderOptions } from "./go/builder";
import { Func, Kind, Struct, Interface, TypeDef } from "./go/types";

const options: GoBuilderOptions = {
  name: "My First Go Project",
};

const builder = new GoBuilder(options);

for (let i = 0; i < 1; i++) {
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

  const varValueNode = builder.CreateVarValueNode("test", {
    type: Kind.INT,
    id: "",
  }, "67")
  const varValueId = builder.SetNode(varValueNode)
  const varNode = builder.CreateVarNode(varValueId)
  const varId = builder.SetNode(varNode)

  const myFunc: FuncDef = {
    type: myFuncType,
    body: [
      varId,
    ]
  }

  const funcNode = builder.CreateFuncNode(myFunc)
  const funcId = builder.SetNode(funcNode)

  builder.ConnectNodes(importId, funcId)
}

const myStruct = new Struct()
  .Name("myStruct")
  .Field("Hello", Kind.STRING, 'json:"hello"')
  .AsDefinition();

const test: Kind = Kind.ARRAY;

const myInterface: TypeDef = new Interface()
  .Name("myInterface")
  .AsDefinition();

{
  (async () => {
    const now = Date.now();
    const output = await builder.Build();
    console.log(`Build time: ${Date.now() - now}ms`);
    console.log(output);
    console.log(
      `size: ${(output.length / 1024 / 1024).toPrecision(4)}Mib (${(output.length / 1024).toPrecision(2)}Kib)`
    );
    let { signal } = new AbortController();
    writeFile("nodes.opt", output, { signal }, (err) => {
      if (!err) return;
      console.error(err);
    });
  })();
}
