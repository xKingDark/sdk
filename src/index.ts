import { fstat, writeFile } from "fs";
import { GoBuilder, GoBuilderOptions, NodeId, FuncDef } from "./go/builder";
import {
  Func,
  PointerType,
  Kind,
  Struct,
  Interface,
  TypeDef,
  Type,
  String,
  ArrayType,
  StructType,
  FuncType,
  InterfaceType,
  Int,
} from "./go/types";

const options: GoBuilderOptions = {
  name: "My First Go Project",
  size: 1000 * 64,
};

const builder = new GoBuilder(options);

for (let i = 0; i < 1; i++) {
  const packageNode = builder.CreatePackageNode("main");
  const packageId = builder.SetNode(packageNode);

  const imports: NodeId[] = ["fmt", "testing"].map((v) => {
    return builder.SetNode(builder.CreateImportValueNode(v));
  });

  const importNode = builder.CreateImportNode(...imports);
  const importId = builder.SetNode(importNode);

  builder.ConnectNodes(packageId, importId);

  const consts: NodeId[] = [
    ["Greeting", "Hello, World!"],
    ["Farewell", "Goodbye, World!"],
  ].map((v) => {
    return builder.SetNode(
      builder.CreateConstValueNode(v[0], Int("Test", 32), v[1]),
    );
  });

  const constNode = builder.CreateConstNode(...consts);
  const constId = builder.SetNode(constNode);

  builder.ConnectNodes(importId, constId);

  const vars: NodeId[] = [
    ["Greeting", "Hello, World!"],
    ["Farewell", "Goodbye, World!"],
  ].map((v) => {
    return builder.SetNode(
      builder.CreateVarValueNode(v[0], Int("Test", 32), v[1]),
    );
  });

  const varNode = builder.CreateVarNode(...vars);
  const varId = builder.SetNode(varNode);

  builder.ConnectNodes(constId, varId);

  const ConditonNode = builder.CreateEqualNode("67", "76");
  const ConditonId = builder.SetNode(ConditonNode);

  const BodyNode = builder.CreateVarNode(vars[0]);
  const BodyId = builder.SetNode(BodyNode);

  const IfNode = builder.CreateIfNode(ConditonId, [BodyId]);
  const IfId = builder.SetNode(IfNode);

  builder.ConnectNodes(varId, IfId);
  const mainFuncType = Func("main", [], []);

  let body: bigint[] = [];
  for (let i = 0; i < 10; i++) {
    builder.SetNode(builder.CreateCallNode("fmt.Println", ["Hello, world!"]));
  }

  //let params: bigint[] = [BigInt(builder.SetString("Hello, world"))];

  const mainFuncDef: FuncDef = {
    type: mainFuncType,
    //params,
    body,
  };
  const mainFuncNode = builder.CreateFuncNode(mainFuncDef);
  const mainFuncId = builder.SetNode(mainFuncNode);
  builder.ConnectNodes(importId, mainFuncId);
}

// const stringArray: ArrayType = Array(String(), [10]);

// const myStruct: StructType = new Struct()
//   .Name("myStruct")
//   .Field("Hello", stringArray, 'json:"hello"')
//   .AsDefinition();

// const myFunc: FuncType = Func("test", [["eg", stringArray]], []);

// const myInterface: InterfaceType = new Interface()
//   .Name("MyInterface")
//   .Method("MyMethod", myFunc)
//   .AsDefinition();

function formatBytes(size: number) {
  if (size === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(size) / Math.log(k));

  return `${(size / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

{
  (async () => {
    builder.PrintNodes();
    builder.PrintLUT();
    console.log(process.memoryUsage());
    const now = Date.now();
    const output = builder.Export();
    //const output = await builder.Rebuild();
    console.log(`Build time: ${Date.now() - now}ms`);
    console.log(output);
    console.log(`size: ${formatBytes(output.length)}`);
    let { signal } = new AbortController();
    writeFile(
      "C:\\Users\\explo\\OneDrive\\Documents\\Projects\\Opticode\\go-compiler\\nodes.opt",
      output,
      { signal },
      (err) => {
        if (!err) return;
        console.error(err);
      },
    );
  })();
}
