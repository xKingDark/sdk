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

export type Type = Kind | string

export interface TypeDef {
  type: Type;
  id: string;
  // For containers (array, slice, pointer, chan, map, etc)
  elem?: TypeDef; // element type

  // For arrays and maps
  len?: number; // array length
  key?: Type; // map key type

  // For functions
  params?: [string, Type][];
  results?: [string, Type][];
  // For method functions
  method?: [string, Type]; 

  // For structs & interfaces
  fields?: {
    name: string;
    type: Type;
    tag?: string;
  }[];

  methods?: {
    name: string;
    func: TypeDef;
  }[];
}

export class Struct {
  private name: string = "UnnamedStruct";
  private fields: {
    name: string;
    type: Type;
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
    type: Type,
    tag?: string,
    value?: string
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
  public AsDefinition(): TypeDef {
    return {
      type: Kind.STRUCT,
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
    if (def.type !== Kind.FUNC) throw new Error("Type definition must be of type func!")
    this.methods.push([name, def]);
    return this;
  }

  /**
   * @remarks Exports the interface as a type definition
   */
  public AsDefinition(): TypeDef {
    return {
      type: Kind.INTERFACE,
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

export function Func(
  name: string,
  results?: [string, Type][],
  method?: [string, Type],
  params?: [string, Type][]
): TypeDef {
  return {
    type: Kind.FUNC,
    id: name,
    method,
    params,
    results,
  };
}
