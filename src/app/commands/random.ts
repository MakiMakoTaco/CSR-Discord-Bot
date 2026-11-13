import createSql from '@/lib/database/connect';
import { AutocompleteCommand, ChatInputCommand, CommandData } from 'commandkit';
import {
	ApplicationCommandChoicesData,
	ApplicationCommandOptionChoiceData,
	ApplicationCommandOptionType,
	MessageFlags,
} from 'discord.js';

interface SideQuery {
	id: number;
	name: string;
	tiers: [
		{
			id: number;
			name: string;
			appendSideName: boolean;
			sideIndex: number;
		},
	];
}

export const command: CommandData = {
	name: 'random-mod',
	description: 'Randomly picks a map, using the wheel from WheelOfNames.com',
	options: [
		{
			name: 'dlc',
			description: 'Whether to include DLC or not',
			type: ApplicationCommandOptionType.Boolean,
		},
		{
			name: 'filter',
			description: 'Limit random mod selection to a specific side/tier',
			type: ApplicationCommandOptionType.String,
			autocomplete: true,
		},
	],
};

export const autocomplete: AutocompleteCommand = async ({ interaction }) => {
	try {
		const sql = createSql();

		let sides = await sql<SideQuery[]>`
      SELECT
        s.id,
        s.name,
        json_agg(
          json_build_object(
            'id', t.id,
            'name', tp.name,
						'append_side_name', tp.append_side_name,
						'sideIndex', tp.side_index
          )
					ORDER BY tp.side_index
        ) AS tiers
      FROM sides s
      LEFT JOIN tiers t
        ON t.side_id = s.id
			LEFT JOIN tier_presets tp
				ON tp.id = t.preset_id
      WHERE s.archived = false
			GROUP BY s.id
			ORDER BY lower(s.name)
    `;

		sql.end();

		const input = interaction.options.getString('filter');
		const responseOptions = sides
			.flatMap((side) => [
				{
					name: side.name,
					value: `${side.id} 0`,
					sideName: side.name,
					index: 0,
				},
				...side.tiers.flatMap((tier) => ({
					name: tier.appendSideName ? `${side.name} ${tier.name}` : tier.name,
					value: `0 ${tier.id}`,
					sideName: side.name,
					index: tier.sideIndex,
				})),
			])
			.sort((a, b) => {
				if (a.sideName === b.sideName) {
					return a.index - b.index;
				} else if (a.sideName.includes('DLC') && b.sideName.includes('DLC')) {
					const numberA: number = Number(a.sideName.split(' ')[1]);
					const numberB: number = Number(b.sideName.split(' ')[1]);

					if (numberA !== numberB) {
						return numberA - numberB;
					} else {
						return a.index - b.index;
					}
				}

				if (a.sideName.includes('Super')) {
					return -1;
				} else if (b.sideName.includes('Super')) {
					return 1;
				}

				if (a.sideName.includes('DLC')) {
					return 1;
				} else if (b.sideName.includes('DLC')) {
					return -1;
				}

				if (a.sideName.includes('Catstare')) {
					if (!b.sideName.includes('DLC')) {
						return 1;
					} else {
						return -1;
					}
				} else if (b.sideName.includes('Catstare')) {
					if (!a.sideName.includes('DLC')) {
						return -1;
					} else {
						return 1;
					}
				}

				return 0;
			})
			.map((response) => ({ name: response.name, value: response.value }));

		if (!input) {
			interaction.respond(responseOptions.splice(0, 25));

			return;
		}

		const filter = responseOptions.filter((response) =>
			response.name.toLowerCase().includes(input.toLowerCase().trim()),
		);

		interaction.respond(filter.splice(0, 25));
	} catch (error) {
		console.error('Autocomplete error', error);
	}
};

export const chatInput: ChatInputCommand = async (ctx) => {
	await ctx.interaction.deferReply({ flags: MessageFlags.Ephemeral });

	const filter = ctx.interaction.options.getString('filter');
	let sideId: number | undefined;
	let tierId: number | undefined;

	if (filter) {
		[sideId, tierId] = filter.split(' ').map((id) => Number(id));
	}

	const sql = createSql();

	const possibleMods = await sql`
		SELECT
			m.name
		FROM mods m
		WHERE ${
			sideId && sideId > 0
				? sql`
			m.tier_id IN (
				SELECT
					t.id
				FROM tiers t
				WHERE t.side_id IN (
					SELECT
						s.id
					FROM sides s
					WHERE s.id = ${sideId}
				)
			)
		`
				: tierId && tierId > 0
					? sql`
			m.tier_id IN (
				SELECT
					t.id
				FROM tiers t
				WHERE t.id = ${tierId}
			)
		`
					: sql`
			m.tier_id IN (
				SELECT
					t.id
				FROM tiers t
				WHERE t.side_id IN (
					SELECT
						s.id
					FROM sides s
					WHERE s.archived = false
				)
			)
		`
		}
	`;

	sql.end();

	// const wheelResult = await fetch()

	await ctx.interaction.editReply('Finished');
};
