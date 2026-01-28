import { ChanDir } from "./golang";
import { packUnsigned64 } from "./utils";

export enum Kind {
  INT = "int",
  INT8 = "int8",
  INT16 = "int16",
  INT32 = "int32",
  INT64 = "int64",
  UINT = "uint",
  UINT8 = "uint8",
  UINT16 = "uint16",
  UINT32 = "uint32",
  UINT64 = "uint64",
  UINTPTR = "uintptr",
  FLOAT32 = "float32",
  FLOAT64 = "float64",
  COMPLEX64 = "complex64",
  COMPLEX128 = "complex128",

  STRING = "string",
  RUNE = "rune",
  BYTE = "byte",

  BOOLEAN = "boolean",

  POINTER = "pointer",
  STRUCT = "struct",
  FUNC = "func",
  ARRAY = "array",
  SLICE = "slice",
  MAP = "map",
  CHANNEL = "channel",
  INTERFACE = "interface",
}

export type Type = Kind | string;

export interface TypeHeader {
  base: Type;
  id: string;
}

export type TypeDef =
  | PointerType
  | InterfaceType
  | StructType
  | FuncType
  | MapType
  | ChanType
  | ArrayType
  | TypeHeader;

export interface PointerType extends TypeHeader {
  elem: TypeDef;
}

export interface InterfaceType extends TypeHeader {
  methods: {
    name: string;
    func: TypeDef;
  }[];
}

export interface StructType extends TypeHeader {
  fields: {
    name: string;
    type: TypeDef;
    tag?: string;
  }[];
}

export interface FuncType extends TypeHeader {
  params: [string, TypeDef][];
  results: [string, TypeDef][];
  method?: [string, TypeDef];
}

export interface MapType extends TypeHeader {
  key: TypeDef;
  value: TypeDef;
}

export interface ChanType extends TypeHeader {
  elem: TypeDef;
  dir: ChanDir;
}

export interface ArrayType extends TypeHeader {
  elem: TypeDef;
  size: bigint; // For multi dimensional arrays, integer is split
}

export class Struct {
  private name: string = "UnnamedStruct";
  private fields: {
    name: string;
    type: TypeDef;
    tag?: string;
    value?: string;
  }[] = [];

  constructor() {
    return;
  }

  /**
   * @remarks
   * Method that sets the struct name
   */
  public Name(name: string): this {
    //! Add regex check here
    this.name = name;
    return this;
  }

  /**
   * @remarks Adds a field to the struct
   * @param name field identifier of the struct
   * @param kind type of the field value
   * @param tag struct field tag (e.g., `json:"example"`)
   * @param value only used when exported as value node
   */
  public Field(
    name: string,
    type: TypeDef,
    tag?: string,
    value?: string,
  ): this {
    //! Add regex check here

    this.fields.push({
      name,
      type,
      tag,
      value,
    });

    return this;
  }

  /**
   * @remarks Exports the struct as a type definition
   */
  public AsDefinition(): StructType {
    return {
      base: Kind.STRUCT,
      id: this.name,
      fields: this.fields.map((f) => {
        return {
          name: f.name,
          type: f.type,
          tag: f.tag,
        };
      }),
    };
  }
}

export class Interface {
  private name = "UnnamedInterface";
  private methods: [string, TypeDef][] = [];

  constructor() {
    return;
  }

  /**
   * @remarks Method that sets the interface name
   */
  public Name(name: string): this {
    this.name = name;
    return this;
  }

  /**
   * @remarks Adds a method to the interface
   * @param name name of method
   * @param def function defintion
   */
  public Method(name: string, def: TypeDef): this {
    if (def.base !== Kind.FUNC)
      throw new Error("Type definition must be of type func!");
    this.methods.push([name, def]);
    return this;
  }

  /**
   * @remarks Exports the interface as a type definition
   */
  public AsDefinition(): InterfaceType {
    return {
      base: Kind.INTERFACE,
      id: this.name,
      methods: this.methods.map((v) => {
        return {
          name: v[0],
          func: v[1],
        };
      }),
    };
  }
}

export function Uint(name: string, bitSize: 8 | 16 | 32 | 64): TypeDef {
  return {
    base: Kind.UINT + bitSize.toString(),
    id: name,
  };
}

export function Uintptr(name: string): TypeDef {
  return {
    base: Kind.UINTPTR,
    id: name,
  };
}

export function Float(name: string, bitSize: 32 | 64): TypeDef {
  return {
    base: "float" + bitSize.toString(),
    id: name,
  };
}

export function Int(name: string, bitSize: 8 | 16 | 32 | 64): TypeDef {
  return {
    base: Kind.INT + bitSize.toString(),
    id: name,
  };
}

export function Complex(name: string, bitSize: 64 | 128): TypeDef {
  return {
    base: "complex" + bitSize.toString(),
    id: name,
  };
}

export function String(name?: string): TypeDef {
  return {
    base: Kind.STRING,
    id: name || "",
  };
}

export function Rune(name: string): TypeDef {
  return {
    base: Kind.RUNE,
    id: name,
  };
}

export function Byte(name: string): TypeDef {
  return {
    base: Kind.BYTE,
    id: name,
  };
}

export function Boolean(name: string): TypeDef {
  return {
    base: Kind.BOOLEAN,
    id: name,
  };
}

export function Func(
  name: string,
  results: [string, TypeDef][],
  params: [string, TypeDef][],
  method?: [string, TypeDef],
): FuncType {
  return {
    base: Kind.FUNC,
    id: name,
    method,
    params,
    results,
  };
}

export function Ptr(def: TypeDef): PointerType {
  return {
    base: Kind.POINTER,
    id: def.id,
    elem: def,
  };
}

export function Chan(
  def: TypeDef,
  dir: ChanDir = ChanDir.Bidirectional,
): ChanType {
  return {
    base: Kind.CHANNEL,
    id: def.id,
    elem: def,
    dir,
  };
}

export function Array(def: TypeDef, size: number[]): ArrayType {
  let base: Kind = Kind.ARRAY;
  if (!size) base = Kind.SLICE;

  return {
    base,
    id: def.id,
    elem: def,
    size: packUnsigned64(size),
  };
}

export function Map(name: string, key: TypeDef, value: TypeDef): MapType {
  return {
    base: Kind.MAP,
    id: name,
    key: key,
    value: value,
  };
}
