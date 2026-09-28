import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

/**
 * Valida que la fecha de esta propiedad NO sea anterior a la de otra propiedad del mismo DTO
 * (ej: dueDate no puede ser anterior a startDate). Misma fecha es valido.
 * Si falta alguna de las dos, o no es una fecha, no opina: de eso se encargan
 * @IsOptional y @IsDateString.
 */
export function IsNotBefore(property: string, validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isNotBefore',
      target: object.constructor,
      propertyName,
      constraints: [property],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const [relatedProperty] = args.constraints as [string];
          const related = (args.object as Record<string, unknown>)[relatedProperty];
          if (typeof value !== 'string' || typeof related !== 'string') return true;

          const current = Date.parse(value);
          const other = Date.parse(related);
          if (Number.isNaN(current) || Number.isNaN(other)) return true;

          return current >= other;
        },
      },
    });
  };
}
