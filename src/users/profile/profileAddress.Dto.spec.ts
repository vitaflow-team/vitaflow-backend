import { ProfileAddressDTO } from './profileAddress.Dto';

describe('ProfileAddressDTO', () => {
  it('should be defined', () => {
    const dto = new ProfileAddressDTO();
    expect(dto).toBeDefined();
  });

  it('should have correct properties', () => {
    const dto = new ProfileAddressDTO();
    dto.addressLine1 = 'Street 1';
    dto.addressLine2 = 'Apt 1';
    dto.district = 'District';
    dto.city = 'City';
    dto.region = 'SP';
    dto.postalCode = '12345-678';

    expect(dto.addressLine1).toBe('Street 1');
    expect(dto.addressLine2).toBe('Apt 1');
    expect(dto.district).toBe('District');
    expect(dto.city).toBe('City');
    expect(dto.region).toBe('SP');
    expect(dto.postalCode).toBe('12345-678');
  });
});
