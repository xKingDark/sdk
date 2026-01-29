import * as fb from "flatbuffers";
import * as go from "./golang";
import * as program from "../program";
//import "async-mutex";
import { FuncType, Kind, Type, TypeDef } from "./types";
import {
  NodeId,
  INode,
  INodeValue,

  IBuilder,
  BuilderOptions,
} from "../ibuilder";

export interface GoBuilderOptions extends BuilderOptions {

}

export interface GoNodeValue extends INodeValue {
  type?: TypeDef;
}

export interface Node extends INode<go.Opcode, GoNodeValue> {

}

export interface FuncDef {
  type: TypeDef; // Must be of FuncType
  params?: NodeId[]; // Input parameters
  body?: NodeId[]; // Array of node id
}

export class GoBuilder extends IBuilder<go.Opcode, go.NodeFlag, go.ValueFlag> {
  constructor(private options: GoBuilderOptions) {
    super(options);

    this.SetString("");
  }

  protected buildNode(node: Node, id: NodeId): fb.Offset {
    let nodeType = program.NodeUnion.NONE;
    let nodeContentOffset: fb.Offset = 0;
    switch (node.flags) {
      case go.NodeFlag.NodeIndexed:
        nodeType = program.NodeUnion.IndexedNode;
        nodeContentOffset = this.CreateIndexedNode(node);
        break;
      case go.NodeFlag.NodeBinary:
        nodeType = program.NodeUnion.BinaryNode;
        nodeContentOffset = this.CreateBinaryNode(node);
        break;
      case go.NodeFlag.NodeUnary:
        nodeType = program.NodeUnion.UnaryNode;
        nodeContentOffset = this.CreateUnaryNode(node);
        break;
    }
    
    program.Node.startNode(this.builder);
    program.Node.addOpcode(this.builder, node.opcode);

    // console.log(`id: ${id}`);
    program.Node.addId(this.builder, id);
    program.Node.addParent(this.builder, node.parent || 0n);
    program.Node.addNext(this.builder, node.next || 0n);
    program.Node.addFlags(this.builder, node.flags);
    program.Node.addNodeType(this.builder, nodeType);
    program.Node.addNode(this.builder, nodeContentOffset);
    return program.Node.endNode(this.builder);
  }

  public SetNode(node: Node, id?: NodeId): NodeId {
    let _id = id || BigInt(this.nodes.size);
    if (this.nodes.has(_id))
      return this.SetNode(node, ++_id); // Retry with new id if exists
    
    const nodeOffset = this.buildNode(node, _id);
    this.nodes.set(_id, [node, nodeOffset]);
    return _id;
  }

  public DeleteNode(id: NodeId, recursive?: boolean) {
    if (recursive) {
      const node = this.nodes.get(id);
      if (!node) {
        console.error(`Unknown id of ${id}`);
        return;
      }
      // WARN - Implement
      for (const n of node[0].fields || []) {
        if (n.flags & go.ValueFlag.Pointer) continue;

        const success = this.nodes.delete(n.value as NodeId);
        if (!success)
          console.warn(`Failed to delete node part of ${id}: ${n.value}`);
      }
    }

    this.nodes.delete(id);
  }

  public UpdateNodeField(id: NodeId, index: number, field: GoNodeValue) {
    const node = this.nodes.get(id);
    if (!node || !node[0].fields) {
      console.error(`Invalid node ${id}.`);
      return;
    }

    if (index < 0 || index > node[0].fields.length) {
      console.error(`Invalid index of ${index}.`);
      return;
    }

    node[0].fields[index] = field;
    const nodeOffset = this.buildNode(node[0], id);
    this.nodes.set(id, [node[0], nodeOffset]);
  }

  public ConnectNodes(parent: NodeId, child: NodeId) {
    const targetNode = this.nodes.get(parent);
    if (!targetNode) {
      console.error(`Could not find node with ${parent}.`);
      return;
    }

    const sourceNode = this.nodes.get(child);
    if (!sourceNode) {
      console.error(`Could not find node with ${child}.`);
      return;
    }

    targetNode[0].next = child;
    sourceNode[0].parent = parent;

    targetNode[0].parent = -1n;
    sourceNode[0].next = -1n;
    const targetNodeOffset = this.buildNode(targetNode[0], parent);
    const sourceNodeOffset = this.buildNode(sourceNode[0], child);
    this.nodes.set(parent, [targetNode[0], targetNodeOffset]);
    this.nodes.set(child, [sourceNode[0], sourceNodeOffset]);
  }

  public CreateNode(opcode: number, flags: number): Node {
    return {
      opcode,
      flags,
    };
  }

  private makeValue(v: string | NodeId, t?: TypeDef): GoNodeValue {
    let flags: number;

    if (typeof v === "bigint") {
      flags = go.ValueFlag.Pointer;
    } else {
      flags = this.isValidNumber(v)
        ? go.ValueFlag.None
        : go.ValueFlag.Quotation;
    }

    return { type: t, value: v, flags };
  }

  private makePtr(v: NodeId): GoNodeValue {
    return {
      value: v,
      flags: go.ValueFlag.Pointer,
    };
  }

  private makePtrFields(values: NodeId[]): GoNodeValue[] {
    return values.map(v => this.makePtr(v));
  }

  private createUnary(opcode: go.Opcode, a: string | NodeId): Node {
    return {
      opcode,
      flags: go.NodeFlag.NodeUnary,
      value: this.makeValue(a),
    };
  }

  private createBinary(opcode: go.Opcode, a: string | NodeId, b: string | NodeId): Node {
    return {
      opcode,
      flags: go.NodeFlag.NodeBinary,
      left: this.makeValue(a),
      right: this.makeValue(b),
    };
  }

  private createIndexed(opcode: go.Opcode, id?: string, fields?: GoNodeValue[]): Node {
    return {
      opcode,
      flags: go.NodeFlag.NodeIndexed,
      id, fields,
    };
  }

  private isValidNumber(str: string): boolean {
    return !isNaN(Number(str));
  }

  public CreatePackageNode(id: string): Node {
    if (id.trim().length <= 0)
      console.error(`Length of package id must be greater than zero!`); // WARN - Add regex check
    
    return this.createIndexed(go.Opcode.Package, id);
  }

  public CreateImportNode(...imports: NodeId[]): Node {
    return this.createIndexed(go.Opcode.Import, undefined, this.makePtrFields(imports));
  }

  public CreateImportValueNode(path: string, alias?: string): Node {
    return this.createBinary(
      go.Opcode.ImportValue,
      alias ?? "",
      path,
    );
  }

  public CreateConstNode(...constants: NodeId[]): Node {
    return this.createIndexed(go.Opcode.Const, undefined, this.makePtrFields(constants));
  }


  public CreateConstValueNode(
    name: string,
    type: TypeDef,
    value: string,
  ): Node {
    return {
      opcode: go.Opcode.ConstValue,
      flags: go.NodeFlag.NodeBinary,

      left: this.makeValue(name, type),
      right: this.makeValue(value),
    };
  }

  public CreateVarNode(...vars: NodeId[]): Node {
    return this.createIndexed(go.Opcode.Var, undefined, this.makePtrFields(vars));
  }

  public CreateVarValueNode(name: string, type: TypeDef, value: string): Node {
    return {
      opcode: go.Opcode.VarValue,
      flags: go.NodeFlag.NodeBinary,

      left: this.makeValue(value, type),
      right: this.makeValue(value),
    };
  }

  public CreateTypeNode(type: TypeDef): Node {
    return this.createIndexed(
      go.Opcode.Type,
      type.id, [
        {
          type,
          value: 0n,
          flags: go.ValueFlag.None,
        },
      ],
    );
  }

  public CreateFuncNode(def: FuncDef): Node {
    const meta: GoNodeValue = {
      type: def.type,
      value: 0n,
      flags: go.ValueFlag.FuncMeta,
    };

    const params = def.params?.map(v => ({
      value: v,
      flags: go.ValueFlag.Pointer | go.ValueFlag.FuncParam,
    })) ?? [];

    const body = def.body?.map(v => ({
      value: v,
      flags: go.ValueFlag.Pointer | go.ValueFlag.FuncBody, // WARN - Add proper value flag definition
    })) ?? [];

    return this.createIndexed(
      go.Opcode.Func,
      def.type.id,
      [ meta, ...params, ...body ]
    );
  }

  public CreateIfNode(
    condition: NodeId,
    body: NodeId[],
    _else: NodeId[] = [],
  ): Node {
    return this.createIndexed(
      go.Opcode.If,
      undefined, [
        {
          value: condition,
          flags: go.ValueFlag.Pointer | go.ValueFlag.IfConditon, // WARN - Add proper value flag definition
        },
        ...body.map((v) => {
          return {
            value: v,
            flags: go.ValueFlag.Pointer | go.ValueFlag.IfBody, // WARN - Add proper value flag definition
          };
        }),
        ..._else.map((v) => {
          return {
            value: v,
            flags: go.ValueFlag.Pointer | go.ValueFlag.IfElse, // WARN - Add proper value flag definition
          };
        }),
      ],
    );
  }

  public CreateForNode(
    init: NodeId,
    cond: NodeId,
    post: NodeId,
    body: NodeId[],
  ): Node {
    return this.createIndexed(
      go.Opcode.For,
      undefined, [
        this.makePtr(init), this.makePtr(cond), this.makePtr(post),
        ...this.makePtrFields(body)
      ],
    );
  }

  public CreateForRangeNode(
    var1: NodeId, // First variable assignment
    var2: NodeId, // Second varable assignment
    value: NodeId, // Ranged value
  ): Node {
    return this.createIndexed(
      go.Opcode.ForRange,
      undefined, [
        this.makePtr(var1), this.makePtr(var2), this.makePtr(value),
      ],
    );
  }

  public CreateSwitchNode(expression: NodeId, body: NodeId[]): Node {
    return this.createIndexed(
      go.Opcode.Switch,
      undefined,
      [ /*this.makePtr(expression),*/ ...this.makePtrFields(body) ],
    );
  }

  public CreateSelectNode(body: NodeId[]): Node {
    return this.createIndexed(
      go.Opcode.Select,
      undefined,
      this.makePtrFields(body),
    );
  }

  public CreateCaseNode(expression: NodeId, body: NodeId[]): Node {
    return this.createIndexed(
      go.Opcode.Case,
      undefined,
      [ this.makePtr(expression), ...this.makePtrFields(body) ],
    );
  }

  public CreateDefaultNode(body: NodeId[]): Node {
    return this.createIndexed(
      go.Opcode.Default,
      undefined,
      this.makePtrFields(body),
    );
  }

  public CreateAddNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.Add, a, b);
  }

  public CreateSubNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.Sub, a, b);
  }

  public CreateMulNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.Mul, a, b);
  }

  public CreateDivNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.Div, a, b);
  }

  public CreateModNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.Mod, a, b);
  }

  public CreateIncNode(a: string | NodeId): Node {
    return this.createUnary(go.Opcode.Inc, a);
  }

  public CreateDecNode(a: string | NodeId): Node {
    return this.createUnary(go.Opcode.Dec, a);
  }

  public CreateAssignNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.Assign, a, b);
  }

  public CreateAddAssignNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.AddAssign, a, b);
  }

  public CreateSubAssignNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.SubAssign, a, b);
  }

  public CreateMulAssignNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.MulAssign, a, b);
  }

  public CreateDivAssignNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.DivAssign, a, b);
  }

  public CreateModAssignNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.ModAssign, a, b);
  }

  public CreateBitAndAssignNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.BitAndAssign, a, b);
  }

  public CreateBitOrAssignNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.BitOrAssign, a, b);
  }

  public CreateBitXorAssignNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.BitXorAssign, a, b);
  }

  public CreateBitClearAssignNode(
    a: string | NodeId,
    b: string | NodeId,
  ): Node {
    return this.createBinary(go.Opcode.BitClearAssign, a, b);
  }

  public CreateLeftShiftAssignNode(
    a: string | NodeId,
    b: string | NodeId,
  ): Node {
    return this.createBinary(go.Opcode.LeftShiftAssign, a, b);
  }

  public CreateRightShiftAssignNode(
    a: string | NodeId,
    b: string | NodeId,
  ): Node {
    return this.createBinary(go.Opcode.RightShiftAssign, a, b);
  }

  public CreateEqualNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.Equal, a, b);
  }

  public CreateNotEqualNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.NotEqual, a, b);
  }

  public CreateLessNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.Less, a, b);
  }

  public CreateLessEqualNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.LessEqual, a, b);
  }

  public CreateGreaterNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.Greater, a, b);
  }

  public CreateGreaterEqualNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.GreaterEqual, a, b);
  }

  public CreateAndNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.Add, a, b);
  }

  public CreateOrNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.Or, a, b);
  }

  public CreateNotNode(a: string | NodeId): Node {
    return this.createUnary(go.Opcode.Not, a);
  }

  public CreateBitAndNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.BitAnd, a, b);
  }

  public CreateBitOrNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.BitOr, a, b);
  }

  public CreateBitXorNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.BitXor, a, b);
  }

  public CreateBitClearNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.BitClear, a, b);
  }

  public CreateLeftShiftNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.LeftShift, a, b);
  }

  public CreateRightShiftNode(a: string | NodeId, b: string | NodeId): Node {
    return this.createBinary(go.Opcode.RightShift, a, b);
  }

  public CreateChanSendNode(chan: NodeId, value: NodeId): Node {
    return this.createBinary(go.Opcode.Send, chan, value);
  }

  public CreateChanReceiveNode(chan: NodeId): Node {
    return this.createUnary(go.Opcode.Receive, chan);
  }

  public CreateAddrOfNode(value: NodeId): Node {
    return this.createUnary(go.Opcode.AddrOf, value);
  }

  public CreateDerefNode(ptr: NodeId): Node {
    return this.createUnary(go.Opcode.Deref, ptr);
  }

  public CreateCallNode(funcId: string, params: (NodeId | string)[]): Node {
    return this.createIndexed(
      go.Opcode.Call,
      funcId,
      params.map(v => this.makeValue(v)),
    );
  }

  public CreateReturnNode(params: NodeId[]): Node {
    return this.createIndexed(go.Opcode.Return, undefined, this.makePtrFields(params));
  }

  public CreateDeferNode(call: NodeId): Node {
    return this.createUnary(go.Opcode.Defer, call);
  }

  public CreateGoRoutineNode(call: NodeId): Node {
    return this.createUnary(go.Opcode.GoRoutine, call);
  }

  // public CreateMapNode(mapDef: TypeDef, body: NodeId[]): Node {
  //   // WARN - needs attention
  //   // return this.createIndexed(go.Opcode.Map, undefined, this.makePtrFields(body));
  // }

  // public CreateArrayNode(arrayDef: TypeDef, body: NodeId[]): Node {
  //   // WARN - needs attention
  //   // return this.createIndexed(go.Opcode.Array, undefined, this.makePtrFields(body));
  // }

  public Panic(expression: NodeId): Node {
    return this.createUnary(go.Opcode.Panic, expression);
  }

  public Recover(): Node {
    return {
      opcode: go.Opcode.Recover,
      flags: go.NodeFlag.None,
    };
  }

  public CreateMakeNode(params: NodeId[]): Node {
    return this.createIndexed(go.Opcode.Make, undefined, this.makePtrFields(params));
  }

  public New(_type: Type): Node {
    return this.createUnary(go.Opcode.New, 0n);
  }

  public CreateLenNode(param: NodeId): Node {
    return this.createUnary(go.Opcode.Len, param);
  }

  public CreateCapNode(param: NodeId): Node {
    return this.createUnary(go.Opcode.Cap, param);
  }

  public CreateAppendNode(params: NodeId[]): Node {
    return this.createIndexed(go.Opcode.Cap, undefined, this.makePtrFields(params));
    /*return {
      opcode: go.Opcode.Cap,
      flags: go.NodeFlag.NodeUnary,
      fields: params.map((v) => {
        return {
          value: v,
          flags: go.ValueFlag.Pointer,
        };
      }),
    };*/
  }

  public CreateCopyNode(dst: NodeId, src: NodeId): Node {
    return this.createBinary(go.Opcode.Copy, dst, src);
  }

  public CreateCloseNode(chan: Type): Node {
    // WARN - NEEDS ATTENTION
    return this.createUnary(go.Opcode.Close, 0n);
  }

  public CreateComplexNode(r: string, i: string): Node {
    return this.createBinary(go.Opcode.Complex, r, i);
  }

  public CreateRealNode(c: NodeId): Node {
    return this.createUnary(go.Opcode.Real, c);
  }

  public CreateImagNode(c: NodeId): Node {
    return this.createUnary(go.Opcode.Imag, c);
  }

  public CreatePrintNode(params: NodeId[]): Node {
    return this.createIndexed(go.Opcode.Print, undefined, this.makePtrFields(params));
  }

  public CreatePrintlnNode(params: NodeId[]): Node {
    return this.createIndexed(go.Opcode.Println, undefined, this.makePtrFields(params));
  }

  private HashString(s: string): number {
    // cite: https://en.wikipedia.org/wiki/Fowler%E2%80%93Noll%E2%80%93Vo_hash_function
    let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis

    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0; // FNV prime and force 32-bit
    }

    return hash >>> 0;
  }

  public SetString(s: string): number {
    const hash = this.HashString(s);

    this.stringlut.set(hash, s);
    return hash;
  }

  public SetType(t: TypeDef): number {
    const hash = this.HashString(t.id);
    if (this.typelut.has(hash)) return hash;

    let typeOffset: fb.Offset = 0;
    switch (t.base) {
      case "func":
        typeOffset = this.CreateFuncType(t);
    }

    //this.buildMutex.acquire();

    program.TypeDef.startTypeDef(this.builder);
    program.TypeDef.addBase(this.builder, this.HashString(t.base));
    program.TypeDef.addId(this.builder, hash);
    program.TypeDef.addTypeType(this.builder, program.Type.FuncType);
    program.TypeDef.addType(this.builder, typeOffset);
    return hash;
  }

  private CreateFuncType(t: TypeDef): fb.Offset {
    if (!("params" in t)) return 0;

    //this.buildMutex.acquire();
    let method: fb.Offset = 0;

    if (t.method)
      method = program.Pair.createPair(
        this.builder,
        this.SetString(t.method[0]),
        this.SetType(t.method[1]),
      );

    let paramsList: fb.Offset[] = [];
    for (const [val, ty] of t.results) {
      paramsList.push(
        program.Pair.createPair(
          this.builder,
          this.SetString(val),
          this.SetType(ty),
        ),
      );
    }
    const params = program.FuncType.createResultsVector(
      this.builder,
      paramsList,
    );

    let resultsList: fb.Offset[] = [];
    for (const [val, ty] of t.results) {
      resultsList.push(
        program.Pair.createPair(
          this.builder,
          this.SetString(val),
          this.SetType(ty),
        ),
      );
    }
    const results = program.FuncType.createResultsVector(
      this.builder,
      resultsList,
    );

    program.FuncType.startFuncType(this.builder);
    program.FuncType.addParams(this.builder, params);
    program.FuncType.addResults(this.builder, results);
    program.FuncType.addMethod(this.builder, method);
    const funcType = program.FuncType.endFuncType(this.builder);
    //this.buildMutex.release();
    return funcType;
  }

  protected CreateStringLUT(): fb.Offset {
    // Convert to array and sort numerically by key
    const entries = Array.from(this.stringlut)
      .sort(([a], [b]) => a - b);

    const offsets = entries.map(([key, value]) => {
      const valueOffset = this.builder.createString(value);

      program.StringEntry.startStringEntry(this.builder);
      program.StringEntry.addKey(this.builder, key); // int key
      program.StringEntry.addValue(this.builder, valueOffset);
      return program.StringEntry.endStringEntry(this.builder);
    });

    return program.App.createLutVector(this.builder, offsets);
  }

  private buildNodeValue(v: GoNodeValue): fb.Offset {
    program.NodeValue.startNodeValue(this.builder);
    /* schema.NodeValue.addType(
      this.builder,
      this.GetString(v.type || "")
    ); */ // WARN - Implement types
    
    if (typeof v.value == "string")
      program.NodeValue.addValue(
        this.builder,
        BigInt(this.SetString(v.value || "")),
      );
    else program.NodeValue.addValue(this.builder, v.value || 0n);

    program.NodeValue.addFlags(this.builder, v.flags);
    return program.NodeValue.endNodeValue(this.builder);
  }

  private CreateIndexedNode(node: Node): fb.Offset {
    const fields = node.fields?.map(v => this.buildNodeValue(v)) ?? [];
    const fieldsVector = program.IndexedNode.createFieldsVector(this.builder, fields);

    program.IndexedNode.startIndexedNode(this.builder);
    program.IndexedNode.addId(this.builder, this.SetString(node.id || ""));
    program.IndexedNode.addFields(this.builder, fieldsVector);

    return program.IndexedNode.endIndexedNode(this.builder);
  }

  private CreateBinaryNode(node: Node): fb.Offset {
    let left: fb.Offset = 0;
    let right: fb.Offset = 0;

    if (node.left) {
      left = this.buildNodeValue(node.left);
    }

    if (node.right) {
      right = this.buildNodeValue(node.right);
    }

    program.BinaryNode.startBinaryNode(this.builder);
    program.UnaryNode.addValue(this.builder, left);
    program.UnaryNode.addValue(this.builder, right);
    return program.BinaryNode.endBinaryNode(this.builder);
  }

  private CreateUnaryNode(node: Node): fb.Offset {
    let value: fb.Offset = 0;
    if (node.value) {
      value = this.buildNodeValue(node.value);
    }

    program.UnaryNode.startUnaryNode(this.builder);
    program.UnaryNode.addValue(this.builder, value);
    return program.UnaryNode.endUnaryNode(this.builder);
  }

  // Initiates a data stream between the recipitant and the end user
  // Use this to feed the compiler the data live
  public Hook(addr: string) {}
}
