import postgres from 'postgres';

function createSql() {
	return postgres(
		`postgres://zelda:${process.env.DATABASE_PASSWORD}@localhost:5432/csr`,
		{
			max: 5,
			fetch_types: false,
			prepare: true,
			transform: postgres.camel,
			debug: true,
		},
	);
}

export default createSql;
